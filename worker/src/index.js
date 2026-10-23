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
  hdkActivityList, hdkConference, relayActivity, verifyActivities, withTimeout, pool,
  hdkWireCategories, hdkWireReport, hdkWireReportRecent, hdkMaterialCommunities, hdkMaterialItems,
  hdkMeituanActivities, hdkMeituanLink, normalizeMeituanActivity, normalizeLifeActivity,
  convertLink, proxyImage, dailyStats, bjDate, fixedLinks, extractLinkMaterial
} from "./core.js";
import { coinBoard, coinPublish, coinAct, coinDelete, coinSeedOwner, coinProbe } from "./coin.js";
import { jdProbe } from "./jd.js";
import { yzLifeBusinesses, yzPromotionLink } from "./yunzhan.js";
import { sendAlert } from "./mailer.js";
import { sendPush, htmlWrap } from "./push.js";

const CACHE_TTL = 600;
const WIRE_TTL = 180;   // 线报流动性高：3 分钟就重取一次
const WIRE_STALE_TTL = 1800;  // 旧线报最多顶 30 分钟（先秒回，后台换新）
const WIRE_BUDGET = 6000;     // 前台等线报的总时间预算：到点就收手，先发已抓到的
const DAILY_CRON = "0 0 * * *";   // 北京时间每天 08:00 → 省钱日报推送
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

/* 重接口专用「过期缓存兜底」（stale-while-revalidate）：
 * L1 = isolate 内存（最快）；L2 = Cache API（跨 isolate / 同机房共享，内存缓存靠不住的地方靠它）。
 * 10 分钟内直接命中；10 分钟~1 小时之间先返回旧数据、后台静默刷新。 */
const HEAVY_STALE = 3600;
function cKey(k) { return new Request("https://wool-cache.internal/" + k); }
async function heavyGet(k) {
  const m = memCache.get(k);
  if (m && Date.now() - m.t < HEAVY_STALE * 1000) return m;
  try {
    const r = await caches.default.match(cKey(k));
    if (r) {
      const j = await r.json();
      if (j && j.data) { memCache.set(k, j); return j; }
    }
  } catch (e) { /* L2 失效就当没有 */ }
  return null;
}
async function heavySet(k, data) {
  const j = { data, t: Date.now() };
  memCache.set(k, j);
  try {
    await caches.default.put(cKey(k), new Response(JSON.stringify(j), { headers: { "cache-control": "public, max-age=" + HEAVY_STALE } }));
  } catch (e) { /* 缓存失败不影响主流程 */ }
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

/* ---------------- AI 分级用模 ----------------
 * 简单检索（"抽纸"、"找找纸巾"）用免费小模型就够了；
 * 复杂推理（凑单、比价、多轮比方案、优惠叠加）才切强模型 —— 既省钱又不掉体验。
 */
const SMART_HINTS = /凑单|凑满|比价|对比|哪个更|怎么买最|最划算|预算|算一下|帮我算|划算|方案|规划|攻略|清单|组合|搭配|一起买|优惠叠加|怎么叠|能省多少|推荐几|这几个|那再|再加|再来|还有没有|顺便|也要/;

function pickModel(messages, env) {
  const cheap = env.LLM_MODEL || "Qwen/Qwen2.5-7B-Instruct";
  const smart = env.LLM_MODEL_SMART || "deepseek-ai/DeepSeek-V4.1-Flash";
  if (!smart || smart === cheap) return cheap;

  const users = messages.filter(m => m.role === "user");
  const last = users.length ? users[users.length - 1] : null;
  const text = (last && last.content) || "";

  let score = 0;
  if (text.length > 40) score += 1;            // 长描述 = 需求复杂
  if (SMART_HINTS.test(text)) score += 2;      // 涉及算账/决策
  if (users.length >= 2) score += 1;           // 多轮追问
  if ((text.match(/[；;、]/g) || []).length >= 2) score += 1;  // 多个条件并列

  return score >= 2 ? smart : cheap;
}

async function llmChat(env, messages) {
  const base = env.LLM_BASE_URL || "https://api.siliconflow.cn/v1";
  const chatMessages = [{ role: "system", content: SYSTEM_PROMPT }].concat(messages);
  const model = pickModel(messages, env);
  let nudge = 0;
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
        model: model,
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
      // 兜底 3：免费小模型偶尔「只聊天不调工具」（凭空编商品/只说"我这就去搜"）——
      //        在还没拿到任何结果时催一次，让它真的去调工具。
      const promising = /稍等|稍后|马上|我这就|这就去|先去|我去搜|正在搜|等我/.test(reply);
      const soundsLikeAnswer = /优惠券|券后|元|折|价|链接|推荐|搜|找|买/.test(reply);
      if (nudge < 1 && !products.length && !redpackets.length && !links.length &&
          (promising || (round === 0 && soundsLikeAnswer))) {
        nudge++;
        chatMessages.push({ role: "user", content: "别只说明或直接凭印象回答，先调用 search_goods 工具把真实商品查出来再回复我。" });
        continue;
      }
      return { reply: reply || "这个我没接上，换个说法再试试？", products, redpackets, links, engine: model };
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
          const link = await relayActivity(env, {
            activityId: hit.activityId,
            activityUrl: hit.url,
            direct: hit.direct || "",
            title: hit.name,
            platform: hit.platform || "",
            channel: hit.channel || ""
          });
          cards = [{
            id: hit.id,
            activityId: hit.activityId,
            name: hit.name,
            platform: hit.platform,
            period: hit.period,
            url: link.url || hit.url,
            taoCode: link.taoCode || "",
            shortUrl: link.shortUrl || "",
            rebate: !!link.rebate,
            note: link.note || ""
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
  return { reply: "这次没查到合适的，换个关键词再试试？", products, redpackets, links, engine: model };
}

/* 本地生活业务列表：美团（好单库，免额外凭据）优先；云瞻仅在配置了凭据时作补充 */
async function lifeBusinessList(env) {
  var out = [];
  var seen = {};
  var cand = [];   // { id, data }
  var BAD_NAME = /隐藏券查询|投流|测试|demo/i;   // 非优惠类/内部活动不展示
  if (env.HDK_APIKEY) {
    // ① 美团官方活动列表
    var d = await hdkMeituanActivities(env);
    if (d) {
      var now = Math.floor(Date.now() / 1000);
      (d.red_activity || []).concat(d.time_activity || []).forEach(function (a) {
        if (!a || !a.activity_id) return;
        if (a.end_time && Number(a.end_time) < now) return;   // 已结束的不展示
        if (BAD_NAME.test(a.activity_name || "")) return;
        var k = "mt:" + a.activity_id;
        if (seen[k]) return;
        seen[k] = 1;
        cand.push({ id: a.activity_id, item: normalizeMeituanActivity(a) });
      });
    }
    // ② 活动中心的本地生活会（外卖/闪购/吃喝玩乐/电影票…）
    var acts = await hdkActivityList(env, 1, "").catch(function () { return []; });
    (acts || []).forEach(function (a) {
      if (a.channel !== "mt" || !a.activityId) return;
      if (BAD_NAME.test(a.name || "")) return;
      var k = "mt:" + a.activityId;
      if (seen[k]) return;
      seen[k] = 1;
      cand.push({ id: a.activityId, item: normalizeLifeActivity(a) });
    });
  }

  // 限并发 + 超时校验：只阻塞核验前 6 条（首屏体验优先），其余直接展示、
  // 取不到链接时前端有兜底提示；SWR 后台刷新会逐步把失效项挤掉
  await pool(cand.slice(0, 6), 5, async function (c) {
    try {
      const u = await withTimeout(hdkMeituanLink(env, c.id, 1), 5000, "life转链");
      if (u) out.push(c.item);
    } catch (e) { /* 超时/失败都跳过 */ }
  });
  cand.slice(6).forEach(function (c) { out.push(c.item); });

  // 排序：外卖/吃喝玩乐/神券优先，闪购类最多 5 个 —— 避免整屏都是同一品牌的闪购专场
  function score(i) {
    var n = i.name || "";
    if (/闪购/.test(n)) return 2;
    if (/外卖|美食|吃喝|神券|红包|会员/.test(n)) return 0;
    return 1;
  }
  out.sort(function (x, y) { return score(x) - score(y); });
  var picked = [], mtCount = 0;
  for (var i = 0; i < out.length && picked.length < 12; i++) {
    if (/闪购/.test(out[i].name || "")) { if (mtCount >= 5) continue; mtCount++; }
    picked.push(out[i]);
  }
  out = picked;

  if (out.length < 4 && env.YZ_APP_KEY && env.YZ_APP_SECRET) {
    var yz = await yzLifeBusinesses(env);
    (yz || []).forEach(function (b) { out.push(b); });
  }
  return out;
}

/* ---------------- 接口健康监控 ----------------
 * 深度体检：把站点真正依赖的每条链路各探一次（真实调用，不是 ping）。
 * 定时任务每 30 分钟跑一次（wrangler.toml [triggers]），异常发邮件；
 * 状态存在 Cache API 里做去重 —— 刚挂立刻报，持续挂最多 2 小时提醒一次。
 */
const SITE_URL = "https://chenking-maker.github.io/yangmao-aihub/";

async function probe(name, fn) {
  const t0 = Date.now();
  try {
    /* 15 秒：Cloudflare 边缘到好单库偶尔单次就要 7~12 秒（实测），
       10 秒会把它判成「挂了」→ 每 30 分钟误发告警。放宽后只抓真故障。 */
    const r = await withTimeout(fn(), 15000, name);
    /* 返回字符串 = 「没配置，不算故障」（比如未配 LLM_API_KEY / 京东官方通道），
       返回 true 或 { ok:true, detail } = 通了；抛异常 = 真的挂了会告警 */
    const note = typeof r === "string" ? r : "";
    const ok = r === true || !!note || (r && r.ok === true);
    return {
      name, ok, ms: Date.now() - t0,
      detail: note || (r && typeof r === "object" && r.detail ? r.detail : "")
    };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t0, detail: String(e.message || e).slice(0, 220) };
  }
}

async function deepHealth(env) {
  const items = [];
  items.push(await probe("好单库·商品搜索", async () => {
    if (!env.HDK_APIKEY) return "未配置 HDK_APIKEY";
    const l = await hdkSearch(env, "纸巾", 1);
    if (!l.length) throw new Error("搜索返回 0 条");
    return true;
  }));
  items.push(await probe("好单库·美团活动", async () => {
    if (!env.HDK_APIKEY) return "未配置 HDK_APIKEY";
    const d = await hdkMeituanActivities(env);
    if (!d) throw new Error("活动列表返回空");
    return true;
  }));
  items.push(await probe("活动会场列表", async () => {
    if (!env.HDK_APIKEY) return "未配置 HDK_APIKEY";
    const l = await hdkActivityList(env, 1, "");
    if (!l.length) throw new Error("会场列表返回 0 条");
    return true;
  }));
  items.push(await probe("AI 对话模型", async () => {
    if (!env.LLM_API_KEY) return "未配置 LLM_API_KEY（前端走演示模式，不算故障）";
    const res = await fetch((env.LLM_BASE_URL || "https://api.siliconflow.cn/v1") + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + env.LLM_API_KEY },
      body: JSON.stringify({ model: env.LLM_MODEL || "Qwen/Qwen2.5-7B-Instruct", messages: [{ role: "user", content: "hi" }], max_tokens: 2 })
    });
    if (!res.ok) throw new Error("LLM " + res.status + " " + (await res.text()).slice(0, 140));
    return true;
  }));
  items.push(await probe("静态站点（GitHub Pages）", async () => {
    const res = await fetch(SITE_URL, { cf: { cacheTtl: 0 } });
    if (!res.ok) throw new Error("站点 " + res.status);
    return true;
  }));
  items.push(await probe("京东联盟官方转链", async () => {
    const r = await jdProbe(env);
    if (!r.ok) {
      /* soft = 参数/权限没配好（未配置、未开通接口权限等）：只提示，不算故障，不告警；
         真的调用报错（网络、签名被拒）才抛异常触发告警。 */
      if (r.soft) return r.reason;
      throw new Error(r.reason);
    }
    return { ok: true, detail: r.url };
  }));
  items.push(await probe("淘金币互助广场（D1）", async () => {
    const r = await coinProbe(env);
    if (typeof r === "string") {
      if (/未绑定|未配置/.test(r)) return r;   // 没配 D1 只提示，不算故障
      throw new Error(r);
    }
    return "在架 " + r.items + " 条";
  }));
  items.push(await probe("省钱日报 · 推送通道", async () => {
    const has = [];
    if (env.PUSH_TOKEN) has.push("PushPlus 微信");
    if (env.WECOM_WEBHOOK) has.push("企业微信机器人");
    if (env.SMTP_PASS) has.push("QQ 邮件告警");
    if (!has.length) return "未配置（日报只生成不推送；在 CF 后台加 PUSH_TOKEN 或 SMTP_PASS 即生效）";
    return "已配置：" + has.join(" / ");
  }));
  return { ts: Date.now(), items };
}

function reportText(rep, down) {
  const lines = rep.items.map(i =>
    (i.ok ? "  ✅ " : "  🔴 ") + i.name + "（" + i.ms + "ms）" + (i.detail ? " · " + i.detail : ""));
  return "时间：" + new Date(rep.ts).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) +
    "\n异常项：" + (down.length ? down.map(d => d.name).join("、") : "无") +
    "\n\n" + lines.join("\n") +
    "\n\n后台：https://dash.cloudflare.com（Workers & Pages → yangmao-aihub → Logs）";
}

/* ---------------- 省钱日报：定时汇总 + 微信推送 ----------------
 * 每天固定时间把「今天给你备好了多少优惠、一共能省多少」推到你微信。
 * 通道见 push.js（PushPlus / 企业微信机器人），任配其一即可。
 */
async function dailyPush(env) {
  const s = await dailyStats(env);
  if (!s) return { skipped: "日报数据生成失败" };
  const done = heavySet("daily:" + s.date, s).catch(() => { /* ignore */ });
  try { await done; } catch (e) { /* ignore */ }

  const topLines = (s.top || []).slice(0, 3).map((t, i) =>
    (i + 1) + ". " + t.title.slice(0, 26) + "　券后 ¥" + t.endPrice + "（省 ¥" + t.off + "）").join("<br>");

  const html = htmlWrap("省钱日报 · " + s.date, [
    { t: "💰 今天一共能省多少", b:
      "在架优惠 <b>" + s.deals + "</b> 件，其中带券 <b>" + s.couponDeals + "</b> 件<br>" +
      "优惠券面额合计 <b style='color:#d93832'>¥" + s.couponSave + "</b><br>" +
      "到手价比原价立省合计 <b style='color:#d93832'>¥" + s.instantSave + "</b>" },
    { t: "📡 线报 & 会场", b:
      "最近 24 小时新线报 <b>" + s.wires + "</b> 条<br>" +
      "可领红包/会场 <b>" + s.activities + "</b> 个，其中 <b>" + s.rebateActivities + "</b> 个走你的专属优惠通道" },
    { t: "🔥 今天最狠的几单", b: topLines || "暂无数据" }
  ]);

  const mail = await sendPush(env, "省钱日报 · " + s.date + "（今天能省 ¥" + s.instantSave + "）", html);
  return { date: s.date, push: mail };
}

/* 定时预热：cron 每 30 分钟把两个重接口的缓存刷热（会场返利核验 + 本地生活列表），
 * 用户请求基本永远命中缓存，不再吃冷启动延迟 */
async function warmup(env) {
  try {
    const list = await hdkActivityList(env, 1, "");
    await verifyActivities(env, list, 12);
    await heavySet("a:", list);
  } catch (e) { /* ignore */ }
  try {
    await heavySet("life:biz2", await lifeBusinessList(env));
  } catch (e) { /* ignore */ }
  /* 线报广场默认页（「全部」= 12 小时 / 50 条）也一起预热，
     用户点进线报页永远是热缓存，不用等翻页 */
  try {
    await heavySet("wn:list:0::12:50", await hdkWireReportRecent("0", 12, 50, 6000));
  } catch (e) { /* ignore */ }
  /* 飞猪旅行：分类专查接口索引滞后（慢 3 天），改从全量流筛，条目稀疏要翻更深，
     所以单独预热，否则前台几秒预算只能捞到一两条 */
  try {
    await heavySet("wn:list:0::飞猪旅行:168:100", await hdkWireReportRecent("0", 168, 100, 25000, "飞猪旅行"));
  } catch (e) { /* ignore */ }
  /* 其余三个实时分类也预热：首次点进对应 tab 同样是热缓存 */
  var wireTabs = [["10003", 24, 200], ["10004", 24, 200], ["10005", 24, 200]];
  for (var wi = 0; wi < wireTabs.length; wi++) {
    try {
      await heavySet("wn:list:0::" + wireTabs[wi][0] + ":" + wireTabs[wi][1] + ":" + wireTabs[wi][2],
        await hdkWireReportRecent(wireTabs[wi][0], wireTabs[wi][1], wireTabs[wi][2], 15000));
    } catch (e) { /* ignore */ }
  }
}

async function scheduledHealth(env) {
  if (!env.ALERT_MAIL_TO) return { skipped: "未配置 ALERT_MAIL_TO，跳过告警" };
  const rep = await deepHealth(env);
  const down = rep.items.filter(i => !i.ok);

  const cache = caches.default;
  const ckey = new Request("https://health-cache.internal/state");
  let prev = null;
  const hit = await cache.match(ckey);
  if (hit) { try { prev = await hit.json(); } catch (e) { /* ignore */ } }

  const now = Date.now();
  const prevDown = !!(prev && prev.down);
  const lastMail = (prev && prev.lastMail) || 0;

  if (!down.length) {
    if (prevDown) await sendAlert(env, "✅ 羊毛AIHUB 接口已恢复", reportText(rep, down));
    await cache.put(ckey, new Response(JSON.stringify({ down: false, ts: now, lastMail })));
    return { ok: true, down: 0, mailed: prevDown };
  }

  if (!prevDown || now - lastMail > 2 * 3600 * 1000) {
    const r = await sendAlert(env, "🔴 羊毛AIHUB 接口异常告警", reportText(rep, down));
    await cache.put(ckey, new Response(JSON.stringify({ down: true, ts: now, lastMail: r.sent ? now : lastMail })));
    return { ok: false, down: down.length, mailed: r.sent, reason: r.reason || "" };
  }
  await cache.put(ckey, new Response(JSON.stringify({ down: true, ts: now, lastMail })));
  return { ok: false, down: down.length, mailed: false, note: "2 小时内已提醒过，静默中" };
}

export default {
  async fetch(request, env, ctx) {
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
        const hit = await heavyGet(key);
        if (hit) {
          const age = (Date.now() - hit.t) / 1000;
          if (age < CACHE_TTL) return json(hit.data);
          if (ctx && ctx.waitUntil) {
            // 过期但可用：先返回旧数据，后台重新核验
            ctx.waitUntil(Promise.resolve().then(async () => {
              const fresh = await hdkActivityList(env, 1, kw);
              await verifyActivities(env, fresh, 12);
              await heavySet(key, fresh);
            }).catch(() => { /* 刷新失败继续用旧的 */ }));
            return json(hit.data);
          }
        }
        // 冷启动：列表先秒回（不打返利标），后台核验完写入缓存，后续访客就能看到标
        const data = await hdkActivityList(env, 1, kw);
        data.forEach(a => { a.rebate = false; delete a.needAuth; });
        const done = verifyActivities(env, data, 12)
          .then(() => heavySet(key, data))
          .catch(() => { /* 核验失败下次再试 */ });
        if (ctx && ctx.waitUntil) ctx.waitUntil(done); else await done;
        return json(data);
      }

      if (url.pathname === "/api/redpacket" && request.method === "POST") {
        if (!env.HDK_APIKEY) return json({ error: "服务端未配置 HDK_APIKEY" }, 503);
        const body = await request.json().catch(() => ({}));
        const r = await relayActivity(env, {
          activityId: body.activityId || "",
          activityUrl: body.activityUrl || "",
          direct: body.direct || "",
          title: body.title || "双11红包会场",
          platform: body.platform || "",
          channel: body.channel || ""
        });
        return json(r);
      }

      /* ---- 实时线报广场：按分类给不同窗口（时间 + 条数双限）----
       *   全部 12h/200 · 飞猪 7天/100 · 百亿补贴·淘宝实时·京东实时 24h/200
       * 前端把 hours/max 带上来，这里做合法性钳制；想回到分页老行为传 hours=0。
       * 缓存 3 分钟（线报流动性高，不能像会场那样长缓存）。 */
      if (url.pathname === "/api/wire") {
        const sub = url.searchParams.get("sub") || "categories";
        const rawHours = url.searchParams.get("hours");
        const hours = Number(rawHours === null ? 12 : rawHours);
        const max = Math.min(Math.max(Number(url.searchParams.get("max")) || 200, 20), 300);
        /* cate：按中文分类从全量流里筛（分类专查接口索引滞后，见 core.js 注释） */
        const cate = (url.searchParams.get("cate") || "").slice(0, 20);
        const key = "wn:" + sub + ":" + (url.searchParams.get("type") || "") + ":" + (url.searchParams.get("tag") || "") + ":" + cate + ":" + hours + ":" + max;

        /* 翻页拉线报要打很多次上游，而 Cloudflare 边缘到好单库一次就可能要好几秒，
           所以这里最看重「秒回」：只要缓存里还有东西，哪怕旧了也先发给用户，
           后台悄悄换新。真没缓存才阻塞等一次（带 8 秒预算）。 */
        const build = async (budget) => {
          let data = null;
          if (sub === "categories") data = await hdkWireCategories();
          else if (sub === "list") {
            const type = url.searchParams.get("type") || "0";
            data = hours > 0
              ? await hdkWireReportRecent(type, hours, max, budget, cate)
              : await hdkWireReport(type, Number(url.searchParams.get("page") || 1));
          } else if (sub === "material") {
            const tag = url.searchParams.get("tag") || "宠物";
            const comms = await hdkMaterialCommunities(tag);
            const items = [];
            for (const c of comms.slice(0, 1)) {
              const list = await hdkMaterialItems(c.id, 1);
              items.push.apply(items, list.slice(0, 12));
            }
            data = { total: items.length, items: items };
          }
          return data === null ? [] : data;
        };

        const hit = await heavyGet(key);
        if (hit) {
          const age = (Date.now() - hit.t) / 1000;
          if (age < WIRE_TTL) return json(hit.data);
          if (age < WIRE_STALE_TTL) {
            /* 旧数据先顶上，后台换新 —— 用户永远不用等翻页。
               后台不急，预算给足（20s），把 200 条这种大列表一次抓满。 */
            if (ctx && ctx.waitUntil) {
              ctx.waitUntil(Promise.resolve().then(() => build(20000)).then(d => heavySet(key, d)).catch(() => { /* 刷新失败继续用旧的 */ }));
            }
            return json(hit.data);
          }
        }

        /* 真没缓存：前台只等 WIRE_BUDGET，超了就先把当前这批发出去，
           后台再补一次「抓满」的（下一次访客就是全量了）。
           稀疏分类（飞猪，从全量流里筛）多给一倍预算，否则只能捞到一两条。 */
        const data = await build(cate ? WIRE_BUDGET * 2 : WIRE_BUDGET);
        if (ctx && ctx.waitUntil) {
          ctx.waitUntil(Promise.resolve().then(() => build(20000)).then(d => heavySet(key, d)).catch(() => { /* ignore */ }));
        } else {
          await heavySet(key, data).catch(() => { /* ignore */ });
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
        /* 转链结果缓存：同一商品（或同一条口令）转出来的推广链接是固定的，
         * 而 Cloudflare 边缘到好单库单次要好几秒 —— 不缓存的话，
         * 同一条线报每次点「转我的链接」都要重等一遍。缓存后第二次起毫秒级返回。
         * TTL 沿用 heavyGet/heavySet：10 分钟新鲜、1 小时内过期先回旧值后台换新。 */
        const mat = extractLinkMaterial(text);
        const cvKey = mat && mat.materialId ? "cv:" + mat.kind + ":" + String(mat.materialId).slice(0, 90) : "";
        if (cvKey) {
          const cvHit = await heavyGet(cvKey);
          if (cvHit && cvHit.data) return json(cvHit.data);
        }
        const r = await convertLink(env, text);
        if (!r) return json({ error: "没识别出可转链的链接，把商品链接再发我一次试试" }, 400);
        if (cvKey && r) {
          if (ctx && ctx.waitUntil) ctx.waitUntil(Promise.resolve(heavySet(cvKey, r)).catch(() => { /* ignore */ }));
          else await heavySet(cvKey, r).catch(() => { /* ignore */ });
        }
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
        const key = "life:biz2";
        const hit = await heavyGet(key);
        if (hit) {
          const age = (Date.now() - hit.t) / 1000;
          if (age < CACHE_TTL) return json({ configured: !!(hit.data && hit.data.length), items: hit.data || [] });
          if (ctx && ctx.waitUntil) {
            ctx.waitUntil(Promise.resolve().then(() => lifeBusinessList(env))
              .then((d) => heavySet(key, d)).catch(() => { /* 刷新失败继续用旧的 */ }));
            return json({ configured: !!(hit.data && hit.data.length), items: hit.data || [] });
          }
        }
        const items = await lifeBusinessList(env);
        const done = heavySet(key, items).catch(() => { /* ignore */ });
        if (ctx && ctx.waitUntil) ctx.waitUntil(done); else await done;
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

      /* ---- 省钱日报：今天为止的全站省钱数据（前端「省钱日报」页读它）---- */
      if (url.pathname === "/api/daily") {
        const key = "daily:" + bjDate(Date.now());
        const hit = await heavyGet(key);
        if (hit && (Date.now() - hit.t) / 1000 < 3600) return json(hit.data);
        const data = await dailyStats(env);
        if (!data) return json({ error: "日报生成失败，稍后再试" }, 502);
        const done = heavySet(key, data).catch(() => { /* ignore */ });
        if (ctx && ctx.waitUntil) ctx.waitUntil(done); else await done;
        return json(data);
      }

      /* ---- 我的固定推广链接（红包按钮 / 口令复制用；不含任何密钥）---- */
      if (url.pathname === "/api/links") {
        return json(fixedLinks(env));
      }

      /* ================= 淘金币互助广场 =================
       * 无登录：前端在 localStorage 里生成一个 uid 代表「我」，IP 取 CF-Connecting-IP。
       * 规则见 worker/src/coin.js 顶部注释：
       * 每个 IP 每天限发 1 条口令；助力留淘宝昵称；站长未满助力 1 次、满了助力 3 次才有发布资格。
       */
      if (url.pathname === "/api/coin/board") {
        return json(await coinBoard(env, {
          uid: url.searchParams.get("uid"),
          tab: url.searchParams.get("tab")
        }));
      }
      if (url.pathname === "/api/coin/publish" && request.method === "POST") {
        const b = await request.json().catch(function () { return {}; });
        return json(await coinPublish(env, {
          uid: b.uid, ip: ip, text: b.text, kind: b.kind, name: b.name, target: b.target
        }));
      }
      if (url.pathname === "/api/coin/act" && request.method === "POST") {
        const b = await request.json().catch(function () { return {}; });
        return json(await coinAct(env, { uid: b.uid, ip: ip, id: b.id, tao: b.tao }));
      }
      if (url.pathname === "/api/coin/del" && request.method === "POST") {
        const b = await request.json().catch(function () { return {}; });
        return json(await coinDelete(env, { uid: b.uid, id: b.id }));
      }
      /* 站长口令补种（cron 每天自动跑一次；也可手动 ?token= 触发） */
      if (url.pathname === "/api/coin/seed") {
        if (!env.ALERT_TOKEN || url.searchParams.get("token") !== env.ALERT_TOKEN) {
          return json({ error: "token 不对" }, 403);
        }
        return json(await coinSeedOwner(env));
      }

      /* ---- 健康检查：?deep=1 时做全链路体检 ---- */
      if (url.pathname === "/api/health") {
        if (url.searchParams.get("deep") === "1") {
          return json(await deepHealth(env));
        }
        return json({ ok: true, hasKey: !!env.HDK_APIKEY, hasLLM: !!env.LLM_API_KEY, ts: Date.now() });
      }

      /* ---- 省钱日报推送测试：?token= 鉴权，会真的推一条到微信 ---- */
      if (url.pathname === "/api/daily/push") {
        if (!env.ALERT_TOKEN || url.searchParams.get("token") !== env.ALERT_TOKEN) {
          return json({ error: "token 不对" }, 403);
        }
        return json(await dailyPush(env));
      }

      /* ---- 告警通道测试：?token= 鉴权，成功会真的发一封邮件 ---- */
      if (url.pathname === "/api/alert/test") {
        if (!env.ALERT_TOKEN || url.searchParams.get("token") !== env.ALERT_TOKEN) {
          return json({ error: "token 不对" }, 403);
        }
        const rep = await deepHealth(env);
        const mail = await sendAlert(env, "🧪 羊毛AIHUB 告警通道测试", reportText(rep, rep.items.filter(i => !i.ok)));
        return json({ health: rep, mail: mail });
      }

      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }
  },

  /* 定时任务：
   *  ① 每天 08:00（北京时间）= 生成「省钱日报」并推送到微信（PushPlus / 企业微信机器人）
   *  ② 每 30 分钟 = 全链路体检（异常发邮件）+ 重接口缓存预热
   * 见 wrangler.toml [triggers] */
  async scheduled(event, env, ctx) {
    const cron = (event && event.cron) || "";
    if (cron === DAILY_CRON) {
      const run = dailyPush(env).catch(function (e) { return { error: String(e && e.message || e) }; });
      if (ctx && ctx.waitUntil) ctx.waitUntil(run);
      return { daily: true };
    }
    /* 每 30 分钟：站长淘金币口令补种（当天已种过会自己跳过，只查一次） */
    if (ctx && ctx.waitUntil) ctx.waitUntil(coinSeedOwner(env).catch(function () { /* ignore */ }));
    const rep = scheduledHealth(env);
    if (ctx && ctx.waitUntil) ctx.waitUntil(warmup(env).catch(() => { /* ignore */ })); else await warmup(env).catch(() => { /* ignore */ });
    return rep;
  }
};
