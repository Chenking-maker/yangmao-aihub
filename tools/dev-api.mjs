/**
 * 羊毛AIHUB 本地开发代理 — 让本地预览用上真实数据
 * 端口 8790，读取 tools/.env 中的 HDK_APIKEY / LLM_API_KEY 等（与 Worker 环境变量同值）
 * 生产环境由 Cloudflare Worker 承担同样职责，本文件仅本地开发用
 *
 * 启动：NODE_USE_ENV_PROXY=1 node tools/dev-api.mjs
 * （沙箱/公司网络需走代理时加 NODE_USE_ENV_PROXY=1；Worker 无此问题）
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  hdkSearch, hdkFeed, hdkRelink, hdkItemDetail, hdkXhdList, parsePastedLink,
  hdkActivityList, hdkConference,
  hdkWireCategories, hdkWireReport, hdkMaterialCommunities, hdkMaterialItems,
  hdkMeituanActivities, hdkMeituanLink, normalizeMeituanActivity,
  convertLink, proxyImage
} from "../worker/src/core.js";
import { yzLifeBusinesses, yzPromotionLink } from "../worker/src/yunzhan.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 8790;

// 极简 .env 解析
const env = {};
try {
  const txt = readFileSync(join(__dirname, ".env"), "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && !m[2].startsWith("#")) env[m[1]] = m[2];
  }
} catch (e) {
  console.warn("[dev-api] 未找到 tools/.env，将返回演示模式错误（复制 .env.example 为 .env）");
}

const memCache = new Map();
function cacheGet(key) {
  const hit = memCache.get(key);
  if (hit && hit.expire > Date.now()) return hit.data;
  return null;
}
function cacheSet(key, data) {
  memCache.set(key, { data, expire: Date.now() + 600000 });
}

function json(res, data, status) {
  const body = JSON.stringify(data);
  res.writeHead(status || 200, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch (e) { resolve({}); }
    });
  });
}

/* ---------- LLM 对话（与 worker/src/index.js 同构，改这里同步改那边） ---------- */
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_goods",
      description: "按关键词搜索带优惠券的商品，返回券后价、优惠券金额、销量、领券链接",
      parameters: {
        type: "object",
        properties: { keyword: { type: "string", description: "商品关键词，如：纯牛奶、蓝牙耳机、抽纸" } },
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
        properties: { type: { type: "integer", description: "1=今日上新 2=9.9包邮 4=聚划算 6=0点秒杀" } },
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
        properties: { keyword: { type: "string", description: "活动关键词，如：超级红包、京享红包、京东主会场" } },
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
        properties: { content: { type: "string", description: "用户发的原文（含链接或口令）" } },
        required: ["content"]
      }
    }
  }
];

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

/* 部分模型（Qwen 系）会把工具调用混在正文里，常见三种形式：
 *   ① {{"name":"search_goods","arguments":{...}}}
 *   ② {"name":"search_goods","arguments":{...}}
 *   ③ query = search_goods("纯牛奶") / search_goods(keyword="纯牛奶")
 * 这里统一解析出来当真正的工具调用用；同时清理最终回复里残留的调用片段。 */
var INLINE_TOOL_NAMES = ["search_goods", "get_feed", "get_redpacket", "convert_link"];
var INLINE_TOOL_FIRST_ARG = { search_goods: "keyword", get_feed: "type", get_redpacket: "keyword", convert_link: "content" };

function parseCallArgs(name, inner) {
  inner = (inner || "").trim();
  if (inner.indexOf("{") === 0) {
    try { return JSON.parse(inner); } catch (e) {}
  }
  var args = {};
  var kv = inner.match(/(\w+)\s*=\s*["']([^"']*)["']/g);
  if (kv) {
    kv.forEach(function (p) {
      var m = p.match(/(\w+)\s*=\s*["']([^"']*)["']/);
      if (m) args[m[1]] = m[2];
    });
    if (Object.keys(args).length) return args;
  }
  var pos = inner.match(/^["']([^"']*)["']$/);
  if (pos) args[INLINE_TOOL_FIRST_ARG[name] || "keyword"] = pos[1];
  return args;
}

function parseInlineToolCall(text) {
  var s = String(text || "");
  var m = s.match(/\{\{\s*"name"\s*:\s*"([a-z_]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}\}/)
    || s.match(/\{\s*"name"\s*:\s*"([a-z_]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/);
  if (m) {
    var args = {};
    try { args = JSON.parse(m[2]); } catch (e) {}
    return { name: m[1], args: args };
  }
  for (var i = 0; i < INLINE_TOOL_NAMES.length; i++) {
    var name = INLINE_TOOL_NAMES[i];
    var fm = s.match(new RegExp("(?:=\\s*|\\b)" + name + "\\s*[(（]([^)）]*)[)）]"));
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
  var out = [];
  list.forEach(function (c, i) {
    if (!c || !c.function || typeof c.function.name !== "string") return;
    var args = c.function.arguments;
    if (args && typeof args !== "string") args = JSON.stringify(args);
    out.push({
      id: c.id || ("call_" + Date.now() + "_" + i),
      type: "function",
      function: { name: c.function.name, arguments: args || "{}" }
    });
  });
  return out;
}

async function llmChat(messages) {
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
    var toolCalls = normalizeToolCalls(msg.tool_calls);
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "OPTIONS") {
    // 预检：无 body 的 204（与 Worker 端保持一致）
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400"
    });
    return res.end();
  }

  try {
    if (url.pathname === "/api/health") {
      return json(res, { ok: true, hasKey: !!env.HDK_APIKEY, hasLLM: !!env.LLM_API_KEY });
    }

    if (url.pathname === "/api/search") {
      if (!env.HDK_APIKEY) return json(res, { error: "未配置 HDK_APIKEY" }, 503);
      const q = url.searchParams.get("q") || "";
      if (!q) return json(res, { error: "缺少 q 参数" }, 400);
      let data = cacheGet("s:" + q);
      if (!data) { data = await hdkSearch(env, q); cacheSet("s:" + q, data); }
      return json(res, data);
    }

    if (url.pathname === "/api/feed") {
      if (!env.HDK_APIKEY) return json(res, { error: "未配置 HDK_APIKEY" }, 503);
      const type = Number(url.searchParams.get("type") || 2);
      let data = cacheGet("f:" + type);
      if (!data) { data = await hdkFeed(env, type); cacheSet("f:" + type, data); }
      return json(res, data);
    }

    if (url.pathname === "/api/activities") {
      if (!env.HDK_APIKEY) return json(res, { error: "未配置 HDK_APIKEY" }, 503);
      const kw = url.searchParams.get("q") || "";
      let data = cacheGet("a:" + kw);
      if (!data) { data = await hdkActivityList(env, 1, kw); cacheSet("a:" + kw, data); }
      return json(res, data);
    }

    if (url.pathname === "/api/redpacket" && req.method === "POST") {
      if (!env.HDK_APIKEY) return json(res, { error: "未配置 HDK_APIKEY" }, 503);
      const body = await readBody(req);
      const r = await hdkConference(env, {
        activityId: body.activityId || "",
        activityUrl: body.activityUrl || "",
        title: body.title || "双11红包会场"
      });
      if (!r.url) return json(res, { error: "该会场暂无可用链接" }, 404);
      return json(res, r);
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
      return json(res, data);
    }

    /* ---- 消灭小红包专区 ---- */
    if (url.pathname === "/api/xhd") {
      if (!env.HDK_APIKEY) return json(res, { error: "未配置 HDK_APIKEY" }, 503);
      let data = cacheGet("xhd");
      if (!data) { data = await hdkXhdList(env); cacheSet("xhd", data); }
      return json(res, data);
    }

    /* ---- 凑单工具：解析用户粘贴的链接/口令 ---- */
    if (url.pathname === "/api/parse" && req.method === "POST") {
      if (!env.HDK_APIKEY) return json(res, { error: "未配置 HDK_APIKEY" }, 503);
      const body = await readBody(req);
      const text = String(body.text || "").slice(0, 500);
      if (!text) return json(res, { error: "缺少 text 参数" }, 400);
      const r = await parsePastedLink(env, text);
      if (!r) return json(res, { error: "没识别出链接或口令，换一个试试" }, 400);
      return json(res, r);
    }

    /* ---- 对话转链：用户发链接 → 优惠归因链接 ---- */
    if (url.pathname === "/api/convert" && req.method === "POST") {
      if (!env.HDK_APIKEY) return json(res, { error: "未配置 HDK_APIKEY" }, 503);
      const body = await readBody(req);
      const text = String(body.text || "").slice(0, 500);
      if (!text) return json(res, { error: "缺少 text 参数" }, 400);
      const r = await convertLink(env, text);
      if (!r) return json(res, { error: "没识别出可转链的链接，把商品链接再发我一次试试" }, 400);
      return json(res, r);
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      if (!env.LLM_API_KEY) return json(res, { error: "LLM 未配置" }, 503);
      const body = await readBody(req);
      const messages = (body.messages || []).filter(function (m) {
        return m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string";
      });
      if (!messages.length) return json(res, { error: "messages 不能为空" }, 400);
      return json(res, await llmChat(messages.slice(-8)));
    }

    if (url.pathname === "/api/img") {
      const img = await proxyImage(url.searchParams.get("u") || "");
      if (img.status !== 200) return json(res, { error: "img error" }, img.status);
      res.writeHead(200, img.headers);
      return res.end(Buffer.from(img.body));
    }

    if (url.pathname === "/api/coupon" && req.method === "POST") {
      if (!env.HDK_APIKEY) return json(res, { error: "未配置 HDK_APIKEY" }, 503);
      const body = await readBody(req);
      if (!body.itemid) return json(res, { error: "缺少 itemid" }, 400);
      return json(res, await hdkRelink(env, body.itemid, body.title));
    }

    /* ---- 本地生活：美团（好单库）优先，云瞻可选 ---- */
    if (url.pathname === "/api/life/business") {
      let items = cacheGet("life:biz2");
      if (!items) {
        items = [];
        if (env.HDK_APIKEY) {
          const d = await hdkMeituanActivities(env);
          if (d) {
            const now = Math.floor(Date.now() / 1000);
            const seen = {};
            ((d.red_activity || []).concat(d.time_activity || [])).forEach((a) => {
              if (!a || !a.activity_id || seen[a.activity_id]) return;
              if (a.end_time && Number(a.end_time) < now) return;
              seen[a.activity_id] = 1;
              items.push(normalizeMeituanActivity(a));
            });
            items.sort((x, y) => (/外卖|闪购/.test(x.name) ? 0 : 1) - (/外卖|闪购/.test(y.name) ? 0 : 1));
            items = items.slice(0, 9);
          }
        }
        if (items.length < 4 && env.YZ_APP_KEY && env.YZ_APP_SECRET) {
          const yz = await yzLifeBusinesses(env);
          (yz || []).forEach((b) => items.push(b));
        }
        cacheSet("life:biz2", items);
      }
      return json(res, { configured: !!(items && items.length), items: items || [] });
    }

    if (url.pathname === "/api/life/link" && req.method === "POST") {
      const body = await readBody(req);
      const id = String(body.id || "").slice(0, 40);
      if (!id) return json(res, { error: "缺少业务 id" }, 400);
      if (id.indexOf("mt:") === 0) {
        if (!env.HDK_APIKEY) return json(res, { error: "服务端未配置 HDK_APIKEY" }, 503);
        const link = await hdkMeituanLink(env, id.slice(3));
        if (!link) return json(res, { error: "这个活动暂时取不到链接，换一个试试" }, 502);
        return json(res, { url: link });
      }
      if (!env.YZ_APP_KEY || !env.YZ_APP_SECRET || !env.YZ_PROMOTION_ID) {
        return json(res, { error: "该业务的优惠链接还没开通" }, 503);
      }
      const link = await yzPromotionLink(env, id, 1);
      if (!link) return json(res, { error: "这个链接刚才没取到，稍后再试一下" }, 502);
      return json(res, { url: link });
    }

    return json(res, { error: "not found" }, 404);
  } catch (err) {
    return json(res, { error: String(err && err.message || err) }, 500);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[dev-api] 羊毛AIHUB 本地 API 代理已启动: http://127.0.0.1:${PORT}`);
  console.log(`[dev-api] 商品数据: ${env.HDK_APIKEY ? "已配置" : "未配置（演示模式）"} · AI 对话: ${env.LLM_API_KEY ? "已配置" : "未配置（降级为实时检索）"}`);
  console.log(`[dev-api] 转链归因: ${env.HDK_TB_NAME ? "淘宝昵称已配置(" + env.HDK_TB_NAME + ")" : "未配置（走领券直链）"} · 京东: ${env.JD_UNION_ID ? "unionId已配置" : "未配置"}`);
  console.log(`[dev-api] 注：8788 若被其他服务占用，本服务固定在 ${PORT}`);
});
