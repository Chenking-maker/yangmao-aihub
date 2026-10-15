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
 *   POST /api/convert {text}         → 对话转链：用户发的链接 → 返利归因链接
 *   POST /api/chat   {messages:[...]} → LLM 对话（function calling 自动调搜索/榜单/红包/转链）
 *   POST /api/coupon {itemid,title}  → 生成淘口令（需淘宝授权，未授权时返回领券直链）
 */

import {
  normalizeList, hdkSearch, hdkFeed, hdkRelink, hdkActivityList, hdkConference,
  hdkWireCategories, hdkWireReport, hdkMaterialCommunities, hdkMaterialItems,
  convertLink, proxyImage
} from "./core.js";

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
- 用户要红包 → 调 get_redpacket 拿到链接后，直接把链接和领取方式发给用户
- 用户想买东西 → 调 search_goods；用户要榜单/随便看看 → 调 get_feed
- 用户发来链接/口令要转链 → 调 convert_link，把转好的优惠链接和有什么券告诉用户
- 用户问凑单 → 结合满减门槛和已选金额，推荐价格合适的商品
- 双11节奏：11.01 00:00 付尾款，11.10 20:00 高潮期红包雨，11.12-11.13 返场捡漏`;

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
    if (!res.ok) throw new Error("LLM error " + res.status);
    const data = await res.json();
    const msg = data.choices[0].message;
    chatMessages.push(msg);

    if (!msg.tool_calls) {
      // 兜底：个别情况下答案会落在 reasoning_content
      const reply = (msg.content || "").trim() || (msg.reasoning_content || "").trim();
      return { reply: reply || "这个我没接上，换个说法再试试？", products, redpackets, links };
    }

    for (const call of msg.tool_calls) {
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return json({}, 204);

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

      /* ---- 对话转链：用户发链接 → 返利归因链接 ---- */
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

      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }
  }
};
