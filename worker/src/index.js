/**
 * 羊毛AIHUB · Cloudflare Worker — API 代理与 AI 对话中枢
 * 密钥全部放在 Worker 环境变量，绝不下发前端；佣金字段由 core.js 在出口处剥离。
 * 数据源对前端不可见，统一呈现为「AI 智能选品」。
 *
 * 路由：
 *   GET  /api/health
 *   GET  /api/search?q=关键词        → AI 选品：带券商品搜索
 *   GET  /api/feed?type=2            → 好价榜单（1=今日上新 2=9.9包邮 4=聚划算 6=0点秒杀）
 *   GET  /api/activities             → 双11 活动/红包会场列表
 *   POST /api/redpacket {activityId|activityUrl,title} → 会场转链（红包归因链接）
 *   GET  /api/wire?type=&page=       → 实时线报广场（分类+列表）
 *   GET  /api/material?tag=宠物      → 宠物/美妆线报（素材圈好物）
 *   GET  /api/xhd                    → 消灭小红包专区（9.9 以下好物）
 *   POST /api/parse {text}           → 凑单工具：解析粘贴的链接/口令 → 商品信息
 *   POST /api/convert {text}         → 对话转链：用户发的链接 → 优惠归因链接
 *   POST /api/chat   {messages:[...]} → LLM 对话（function calling 自动调搜索/榜单/红包/转链）
 *   POST /api/coupon {itemid,title}  → 生成淘口令（需淘宝授权，未授权时返回领券直链）
 *   GET  /api/life/business          → 本地生活热门 CPS 业务（云瞻平台，含美团/饿了么/电影/打车等）
 *   POST /api/life/link {id}         → 获取某个本地生活业务的推广链接（云瞻转链）
 */

import {
  normalizeList, hdkSearch, hdkFeed, hdkRelink, hdkItemDetail, hdkXhdList, parsePastedLink,
  hdkActivityList, hdkConference,
  hdkWireCategories, hdkWireReport, hdkMaterialCommunities, hdkMaterialItems,
  hdkMeituanActivities, hdkMeituanLink, normalizeMeituanActivity,
  convertLink, proxyImage
} from "./core.js";
import { yzLifeBusinesses, yzPromotionLink } from "./yunzhan.js";

const CACHE_TTL = 600;
const memCache = new Map();

function cacheGet(key) {
  const hit = memCache.get(key);
  if (hit && hit.expire > Date.now()) return hit.data;
  memCache.delete(key);
  return null;
}
function cacheSet(key, data) {
  memCache.set(key, { data, expire: Date.now() + CACHE_TTL * 1000 });
}

const rateMap = new Map();
function rateLimit(ip) {
  const now = Date.now();
  let rec = rateMap.get(ip);
  if (!rec || rec.reset < now) {
    rec = { count: 0, reset: now + 60000 };
    rateMap.set(ip, rec);
  }
  rec.count++;
  return rec.count <= 40;
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}

/* ================= LLM function calling ================= */

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_goods",
      description: "按关键词搜索带优惠券的商品，返回券后价、优惠券金额、销量、领券链接",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "商品关键词，如：纯牛奶、蓝牙耳机、抽纸" }
        },
        required: ["keyword"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_feed",
      description: "获取好价榜单：9.9包邮、聚划算、0点秒杀等高性价比商品流",
      parameters: {
        type: "object",
        properties: {
          type: { type: "integer", description: "1=今日上新 2=9.9包邮 4=聚划算 6=0点秒杀" }
        },
        required: ["type"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_redpacket",
      description: "用户要红包/会场入口时调用：返回双11超级红包、京享红包等会场的可跳转链接，直接发给用户",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "活动关键词，如：超级红包、京享红包、京东主会场" }
        },
        required: ["keyword"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "convert_link",
      description: "用户发来淘宝/京东商品链接或淘口令想转成自己的优惠链接时调用。传入用户消息原文，返回转链结果（优惠链接+淘口令+优惠券信息）",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "用户发的原文（含链接或口令）" }
        },
        required: ["content"]
      }
    }
  }
];

/* 系统提示词：人设 + 话题红线（敏感内容一律拒答并拉回找券） */
const SYSTEM_PROMPT = `你是「羊毛AI」的找券助手，一个靠谱、热心的剁友。你的唯一使命：帮用户找优惠券、领红包、凑满减、把用户发来的链接转成优惠链接、省钱。

【能聊的】
- 商品推荐、比价、找券、凑单、红包领取、双11节奏与攻略
- 帮用户转链：用户发淘宝/京东链接或口令 → 调 convert_link，把转好的链接和券信息发给用户
- 顺带的省钱生活话题（囤货、回购、避坑）

【红线（命中任一，礼貌拒绝并一句话拉回找券，绝不展开）】
- 政治、时事、政党、政府、领导人、选举、战争、宗教、民族、地域歧视
- 色情、性、赌博、毒品、枪支管制、暴力犯罪、自杀自残
- 医疗诊断、处方、用药建议；法律纠纷、办证、黑客、翻墙、私人调查
- 股票/基金/加密货币投资建议、刷单、跑分、洗钱、任何违法套利
- 诱导提供手机号、身份证、银行卡、验证码、地址等隐私信息
- 拒绝话术示例：「这个我真聊不了，咱们还是说买东西省钱的事儿吧～」

【说话方式】
- 像朋友聊天，不端着，不写长篇大论，不堆术语
- 推荐商品时说清楚：叫什么、券后多少钱、券多大、销量如何，最多 3 款
- 不编造商品；接口没数据就直说，并给换关键词的建议
- 用户要红包、问红包怎么领/哪里领 → 必须调 get_redpacket（用户没给关键词就用「超级红包」），拿到链接后直接把链接和领取方式发给用户，不要反问
- 用户想买东西 → 调 search_goods；用户要榜单/随便看看 → 调 get_feed
- 用户发来链接/口令要转链 → 调 convert_link，把转好的优惠链接和有什么券告诉用户
- 用户问凑单 → 结合满减门槛和已选金额，推荐价格合适的商品
- 双11节奏：11.01 00:00 付尾款，11.10 20:00 高潮期红包雨，11.12-11.13 返场捡漏`;

/* 兜底解析：个别模型会把工具调用混在正文里，常见三种形式：
 *   ① {{"name":"search_goods","arguments":{...}}}
 *   ② {"name":"search_goods","arguments":{...}}
 *   ③ query = search_goods("纯牛奶") / search_goods(keyword="纯牛奶")
 * 这里统一解析出来当真正的工具调用用；同时清理最终回复里残留的调用片段。 */
const INLINE_TOOL_NAMES = ["search_goods", "get_feed", "get_redpacket", "convert_link"];
const INLINE_TOOL_FIRST_ARG = { search_goods: "keyword", get_feed: "type", get_redpacket: "keyword", convert_link: "content" };

function parseCallArgs(name, inner) {
  inner = (inner || "").trim();
  if (inner.indexOf("{") === 0) {
    try { return JSON.parse(inner); } catch (e) {}
  }
  const args = {};
  const kv = inner.match(/(\w+)\s*=\s*["']([^"']*)["']/g);
  if (kv) {
    kv.forEach((p) => {
      const m = p.match(/(\w+)\s*=\s*["']([^"']*)["']/);
      if (m) args[m[1]] = m[2];
    });
    if (Object.keys(args).length) return args;
  }
  const pos = inner.match(/^["']([^"']*)["']$/);
  if (pos) args[INLINE_TOOL_FIRST_ARG[name] || "keyword"] = pos[1];
  return args;
}

function parseInlineToolCall(text) {
  const s = String(text || "");
  const m = s.match(/\{\{\s*"name"\s*:\s*"([a-z_]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}\}/)
    || s.match(/\{\s*"name"\s*:\s*"([a-z_]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/);
  if (m) {
    let args = {};
    try { args = JSON.parse(m[2]); } catch (e) {}
    return { name: m[1], args: args };
  }
  for (const name of INLINE_TOOL_NAMES) {
    const fm = s.match(new RegExp("(?:=\\s*|\\b)" + name + "\\s*[(（]([^)）]*)[)）]"));
    if (fm) return { name: name, args: parseCallArgs(name, fm[1]) };
  }
  return null;
}
function cleanReply(t) {
  return String(t || "")
    .replace(/\{\{[\s\S]*?\}\}/g, "")
    .replace(/(?:query\s*=\s*|调用\s*|call\s+)?(?:search_goods|get_feed|get_redpacket|convert_link)\s*[(（][^)）]*[)）]/g, "")
    .trim();
}

/* 规整模型返回的工具调用：补齐 type=function、arguments 转字符串、剔除畸形项。
 * 上游对 tool_calls 校验严格（缺 type / 空数组都会 400），必须先净化再回传历史。 */
function normalizeToolCalls(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach((c, i) => {
    if (!c || !c.function || typeof c.function.name !== "string") return;
    let args = c.function.arguments;
    if (args && typeof args !== "string") args = JSON.stringify(args);
    out.push({
      id: c.id || ("call_" + Date.now() + "_" + i),
      type: "function",
      function: { name: c.function.name, arguments: args || "{}" }
    });
  });
  return out;
}

async function llmChat(env, messages) {
  const base = env.LLM_BASE_URL || "https://api.siliconflow.cn/v1";
  const chatMessages = [{ role: "system", content: SYSTEM_PROMPT }].concat(messages);
  let products = [];
  let redpackets = [];
  let links = [];

  for (let round = 0; round < 4; round++) {
    const res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + env.LLM_API_KEY
      },
      body: JSON.stringify({
        model: env.LLM_MODEL || "Qwen/Qwen2.5-7B-Instruct",
        messages: chatMessages,
        tools: TOOLS,
        temperature: 0.5,
        // 混合推理模型（GLM 系）需要关闭思考答案才会进 content；对非推理模型无副作用
        enable_thinking: false
      })
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error("LLM error " + res.status + " " + errBody.slice(0, 300));
    }
    const data = await res.json();
    const msg = data.choices[0].message;
    chatMessages.push(msg);

    // 兜底 1：模型把工具调用写进正文（{{"name":...,"arguments":...}}）时，解析出来当真调用用
    let toolCalls = normalizeToolCalls(msg.tool_calls);
    if (!toolCalls.length && msg.content) {
      const inline = parseInlineToolCall(msg.content);
      if (inline) {
        toolCalls = [{ id: "call_inline_" + round, type: "function", function: { name: inline.name, arguments: JSON.stringify(inline.args) } }];
      }
    }
    if (toolCalls.length) msg.tool_calls = toolCalls;
    else delete msg.tool_calls;

    if (!toolCalls.length) {
      // 兜底 2：个别情况下答案会落在 reasoning_content
      const reply = cleanReply((msg.content || "").trim() || (msg.reasoning_content || "").trim());
      return { reply: reply || "这个我没接上，换个说法再试试？", products, redpackets, links };
    }

    for (const call of toolCalls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch (e) {}
      let cards = [];
      if (call.function.name === "search_goods") {
        cards = (await hdkSearch(env, args.keyword || "", 20)).slice(0, 3);
      } else if (call.function.name === "get_feed") {
        cards = (await hdkFeed(env, args.type || 2, 20)).slice(0, 3);
      } else if (call.function.name === "get_redpacket") {
        const acts = await hdkActivityList(env, 1, args.keyword || "");
        const hit = acts[0] || null;
        if (hit) {
          const link = await hdkConference(env, {
            activityId: hit.activityId,
            activityUrl: hit.url,
            title: hit.name
          });
          cards = [{
            id: hit.id,
            activityId: hit.activityId,
            name: hit.name,
            platform: hit.platform,
            period: hit.period,
            url: link.url || hit.url,
            taoCode: link.taoCode || "",
            shortUrl: link.shortUrl || ""
          }];
          redpackets = redpackets.concat(cards);
        }
      } else if (call.function.name === "convert_link") {
        const r = await convertLink(env, args.content || "");
        if (r) {
          cards = [r];
          links = links.concat(cards);
        }
      }
      products = products.concat(cards.filter(function (c) { return c.title; }));
      chatMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(cards) });
    }
  }
  return { reply: "这次没查到合适的，换个关键词再试试？", products, redpackets, links };
}

/* 本地生活业务列表：美团（好单库，免额外凭据）优先；云瞻仅在配置了凭据时作补充 */
async function lifeBusinessList(env) {
  var out = [];
  if (env.HDK_APIKEY) {
    var d = await hdkMeituanActivities(env);
    if (d) {
      var now = Math.floor(Date.now() / 1000);
      var seen = {};
      (d.red_activity || []).concat(d.time_activity || []).forEach(function (a) {
        if (!a || !a.activity_id || seen[a.activity_id]) return;
        if (a.end_time && Number(a.end_time) < now) return; // 已结束的活动不展示
        seen[a.activity_id] = 1;
        out.push(normalizeMeituanActivity(a));
      });
      // 外卖 / 闪购类红包排前面
      out.sort(function (x, y) {
        var w = function (i) { return /外卖|闪购/.test(i.name) ? 0 : 1; };
        return w(x) - w(y);
      });
      out = out.slice(0, 9);
    }
  }
  if (out.length < 4 && env.YZ_APP_KEY && env.YZ_APP_SECRET) {
    var yz = await yzLifeBusinesses(env);
    (yz || []).forEach(function (b) { out.push(b); });
  }
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // CORS 预检：必须返回「无 body 的 204」+ CORS 头。
    // 注意：不能用 json({}, 204)——Response 在 204 状态下不允许带 body，
    // 构造时会直接抛异常导致预检 500，浏览器随即拦下所有跨域 POST（转链/领券/AI 对话）。
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400"
        }
      });
    }

    const ip = request.headers.get("cf-connecting-ip") || "anon";
    if (!rateLimit(ip)) return json({ error: "请求太频繁，歇一会儿再试" }, 429);

    try {
      if (url.pathname === "/api/health") {
        return json({ ok: true, hasKey: !!env.HDK_APIKEY, hasLLM: !!env.LLM_API_KEY, ts: Date.now() });
      }

      if (url.pathname === "/api/search") {
        if (!env.HDK_APIKEY) return json({ error: "服务端未配置 HDK_APIKEY" }, 503);
        const q = url.searchParams.get("q") || "";
        if (!q) return json({ error: "缺少 q 参数" }, 400);
        const key = "s:" + q;
        let data = cacheGet(key);
        if (!data) { data = await hdkSearch(env, q); cacheSet(key, data); }
        return json(data);
      }

      if (url.pathname === "/api/feed") {
        if (!env.HDK_APIKEY) return json({ error: "服务端未配置 HDK_APIKEY" }, 503);
        const type = Number(url.searchParams.get("type") || 2);
        const key = "f:" + type;
        let data = cacheGet(key);
        if (!data) { data = await hdkFeed(env, type); cacheSet(key, data); }
        return json(data);
      }

      if (url.pathname === "/api/activities") {
        if (!env.HDK_APIKEY) return json({ error: "服务端未配置 HDK_APIKEY" }, 503);
        const kw = url.searchParams.get("q") || "";
        const key = "a:" + kw;
        let data = cacheGet(key);
        if (!data) { data = await hdkActivityList(env, 1, kw); cacheSet(key, data); }
        return json(data);
      }

      if (url.pathname === "/api/redpacket" && request.method === "POST") {
        if (!env.HDK_APIKEY) return json({ error: "服务端未配置 HDK_APIKEY" }, 503);
        const body = await request.json().catch(() => ({}));
        const r = await hdkConference(env, {
          activityId: body.activityId || "",
          activityUrl: body.activityUrl || "",
          title: body.title || "双11红包会场"
        });
        if (!r.url) return json({ error: "该会场暂无可用链接" }, 404);
        return json(r);
      }

      /* ---- 实时线报广场 ---- */
      if (url.pathname === "/api/wire") {
        const sub = url.searchParams.get("sub") || "categories";
        const key = "w:" + sub + ":" + (url.searchParams.get("type") || "") + ":" + (url.searchParams.get("tag") || "");
        let data = cacheGet(key);
        if (!data) {
          if (sub === "categories") data = await hdkWireCategories();
          else if (sub === "list") {
            const type = url.searchParams.get("type") || "0";
            const page = Number(url.searchParams.get("page") || 1);
            data = await hdkWireReport(type, page);
          } else if (sub === "material") {
            const tag = url.searchParams.get("tag") || "宠物";
            const comms = await hdkMaterialCommunities(tag);
            const items = [];
            for (const c of comms.slice(0, 1)) {
              const list = await hdkMaterialItems(c.id, 1);
              items.push.apply(items, list.slice(0, 12));
            }
            data = { total: items.length, items: items };
          } else data = [];
          cacheSet(key, data);
        }
        return json(data);
      }

      /* ---- 消灭小红包专区 ---- */
      if (url.pathname === "/api/xhd") {
        if (!env.HDK_APIKEY) return json({ error: "服务端未配置 HDK_APIKEY" }, 503);
        let data = cacheGet("xhd");
        if (!data) { data = await hdkXhdList(env); cacheSet("xhd", data); }
        return json(data);
      }

      /* ---- 凑单工具：解析用户粘贴的链接/口令 ---- */
      if (url.pathname === "/api/parse" && request.method === "POST") {
        if (!env.HDK_APIKEY) return json({ error: "服务端未配置 HDK_APIKEY" }, 503);
        const body = await request.json().catch(() => ({}));
        const text = String(body.text || "").slice(0, 500);
        if (!text) return json({ error: "缺少 text 参数" }, 400);
        const r = await parsePastedLink(env, text);
        if (!r) return json({ error: "没识别出链接或口令，换一个试试" }, 400);
        return json(r);
      }

      /* ---- 对话转链：用户发链接 → 优惠归因链接 ---- */
      if (url.pathname === "/api/convert" && request.method === "POST") {
        if (!env.HDK_APIKEY) return json({ error: "服务端未配置 HDK_APIKEY" }, 503);
        const body = await request.json().catch(() => ({}));
        const text = String(body.text || "").slice(0, 500);
        if (!text) return json({ error: "缺少 text 参数" }, 400);
        const r = await convertLink(env, text);
        if (!r) return json({ error: "没识别出可转链的链接，把商品链接再发我一次试试" }, 400);
        return json(r);
      }

      if (url.pathname === "/api/chat" && request.method === "POST") {
        if (!env.LLM_API_KEY) return json({ error: "LLM 未配置" }, 503);
        const body = await request.json().catch(() => ({}));
        const messages = (body.messages || []).filter(function (m) {
          return m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string";
        });
        if (!messages.length) return json({ error: "messages 不能为空" }, 400);
        return json(await llmChat(env, messages.slice(-8)));
      }

      if (url.pathname === "/api/img") {
        var img = await proxyImage(url.searchParams.get("u") || "");
        if (img.status !== 200) return json({ error: "img error" }, img.status);
        return new Response(img.body, { status: 200, headers: img.headers });
      }

      if (url.pathname === "/api/coupon" && request.method === "POST") {
        if (!env.HDK_APIKEY) return json({ error: "服务端未配置 HDK_APIKEY" }, 503);
        const body = await request.json().catch(() => ({}));
        if (!body.itemid) return json({ error: "缺少 itemid" }, 400);
        return json(await hdkRelink(env, body.itemid, body.title));
      }

      /* ---- 本地生活：热门业务列表（美团走好单库，零第三方凭据）---- */
      if (url.pathname === "/api/life/business") {
        var items = cacheGet("life:biz2");
        if (!items) { items = await lifeBusinessList(env); cacheSet("life:biz2", items); }
        return json({ configured: !!(items && items.length), items: items || [] });
      }

      /* ---- 本地生活：获取某个业务的推广链接 ---- */
      if (url.pathname === "/api/life/link" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const id = String(body.id || "").slice(0, 40);
        if (!id) return json({ error: "缺少业务 id" }, 400);
        if (id.indexOf("mt:") === 0) {
          if (!env.HDK_APIKEY) return json({ error: "服务端未配置 HDK_APIKEY" }, 503);
          const link = await hdkMeituanLink(env, id.slice(3));
          if (!link) return json({ error: "这个活动暂时取不到链接，换一个试试" }, 502);
          return json({ url: link });
        }
        if (!env.YZ_APP_KEY || !env.YZ_APP_SECRET || !env.YZ_PROMOTION_ID) {
          return json({ error: "该业务的优惠链接还没开通" }, 503);
        }
        const yzLink = await yzPromotionLink(env, id, 1);
        if (!yzLink) return json({ error: "这个链接刚才没取到，稍后再试一下" }, 502);
        return json({ url: yzLink });
      }

      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }
  }
};
