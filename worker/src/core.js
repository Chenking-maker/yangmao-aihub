/**
 * 羊毛AIHUB 共享核心 — Cloudflare Worker 与本地开发代理共用
 * 铁律：normalizeProduct / normalizeActivity / normalizeWire / convertLink 只输出前端可见字段，
 *       佣金类字段（tkrates/tkmoney/max_commission_rate/commission）永不外泄。
 * 数据源对前端不可见，统一呈现为「AI 智能选品」。
 */

import { jdUniversal, jdReady } from "./jd.js";

export const HDK_BASE = "https://v3.api.haodanku.com";
export const HDK_WWW = "https://www.haodanku.com";
export { jdReady };

/* ================= 商品 ================= */

export function normalizeProduct(g) {
  var title = g.itemtitle || g.itemshorttitle || "";
  return {
    id: g.itemid || g.product_id || "",
    title: title,
    shortTitle: g.itemshorttitle || title.slice(0, 24),
    shop: g.shopname || g.sellernick || "",
    sales: Number(g.itemsale || g.todaysale || 0),
    price: g.itemprice || "0",
    endPrice: g.itemendprice || g.itemprice || "0",
    coupon: Number(g.couponmoney || 0),
    pic: g.itempic || "",
    couponurl: g.couponurl || ""
  };
}

export function normalizeList(raw) {
  var list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.data) ? raw.data : []);
  return list.map(normalizeProduct);
}

export async function hdkSearch(env, keyword, back) {
  back = back || 20;
  var url = HDK_BASE + "/supersearch?apikey=" + encodeURIComponent(env.HDK_APIKEY) +
    "&keyword=" + encodeURIComponent(keyword) + "&back=" + back;
  var res = await fetch(url);
  return normalizeList(await res.json());
}

export async function hdkFeed(env, type, back) {
  back = back || 20;
  var url = HDK_BASE + "/column?apikey=" + encodeURIComponent(env.HDK_APIKEY) +
    "&type=" + (type || 2) + "&back=" + back;
  var res = await fetch(url);
  return normalizeList(await res.json());
}

/* 商品详情：按商品 ID 取标题/价格/主图（凑单工具解析用户粘贴的链接用） */
export async function hdkItemDetail(env, itemid) {
  var url = HDK_BASE + "/item_detail?apikey=" + encodeURIComponent(env.HDK_APIKEY) +
    "&itemid=" + encodeURIComponent(itemid);
  var res = await fetch(url);
  var json = await res.json();
  var d = json && json.data;
  if (!d) return null;
  if (Array.isArray(d)) d = d[0];
  if (!d || !d.itemid) return null;
  return normalizeProduct(d);
}

/* 消灭小红包：9.9 包邮榜里券后价低于 9.9 的商品（红包可直接抵掉的那种） */
export async function hdkXhdList(env) {
  var url = HDK_BASE + "/column?apikey=" + encodeURIComponent(env.HDK_APIKEY) +
    "&type=2&back=50";
  var res = await fetch(url);
  var list = normalizeList(await res.json());
  return list
    .filter(function (p) { return Number(p.endPrice) > 0 && Number(p.endPrice) < 9.9; })
    .sort(function (a, b) { return Number(a.endPrice) - Number(b.endPrice); });
}

/* 商品转链：无 tb_name 时也能生成领券直链；有 tb_name 则归因到推广位。
 * 佣金率字段（max_commission_rate 等）在此剥离，绝不出现在返回值里。 */
export async function hdkRelink(env, itemid, title) {
  var body = new URLSearchParams({
    apikey: env.HDK_APIKEY,
    itemid: String(itemid),
    pid: env.HDK_PID || "",
    get_taoword: "1",
    title: title || "好物推荐"
  });
  if (env.HDK_TB_NAME) body.set("tb_name", env.HDK_TB_NAME);
  var res = await fetch(HDK_BASE + "/ratesurl", { method: "POST", body: body });
  var json = await res.json();
  if (!json || json.code !== 1 || !json.data) return null;
  var d = json.data;
  return {
    url: d.coupon_click_url || d.item_url || d.tbk_url || "",
    taoCode: d.taoword || "",
    coupon: Number(d.couponmoney || 0),
    converted: true
  };
}

/* 京东商品转链：带 JD_UNION_ID（京东联盟推广位）走好单库统一转链口。
 * 接口异常时返回 null，由调用方降级为原始链接。 */
export async function hdkJdRelink(env, materialId, couponUrl) {
  var body = new URLSearchParams({
    apikey: env.HDK_APIKEY,
    material_id: String(materialId)
  });
  if (couponUrl) body.set("coupon_url", String(couponUrl));
  if (env.JD_UNION_ID) body.set("subUnionId", String(env.JD_UNION_ID));
  try {
    var res = await fetch(HDK_BASE + "/unify_jditems_link", { method: "POST", body: body });
    var json = await res.json();
    if (json && json.code === 1 && json.data && json.data.clickURL) {
      return { url: json.data.clickURL, shortUrl: json.data.shortURL || "", converted: true };
    }
  } catch (e) { /* 降级 */ }
  return null;
}

/* ================= 活动 / 红包会场 ================= */

/* 好单库活动中心 platform 码（实测自 /openapi/activity_list?cat_id=111）
 * 1 淘宝 · 2 京东 · 3 拼多多 · 4 抖音 · 5 美团 · 6 美团(外卖/到店)
 * 7 淘宝闪购 · 12 淘票票 · 15 淘宝(88VIP) · 16 淘宝(飞猪/度假) */
var PLATFORM_NAMES = {
  "1": "淘宝", "2": "京东", "3": "拼多多", "4": "抖音",
  "5": "美团", "6": "美团", "7": "淘宝闪购", "12": "淘票票",
  "15": "淘宝", "16": "淘宝"
};

/* 没有可转链物料、也没有原始 url 时，给个能点得动的官方入口兜底 ——
 * 有 url 的一律优先用 url，这里是最后的「直达会场」保证。 */
var PLATFORM_HOME = {
  "1": "https://m.tb.cn/.TBD11",
  "2": "https://pro.m.jd.com/mall/active/4Gks5dMzJmvvP3Dt7T9mF7pjt3fV/index.html",
  "4": "https://www.douyin.com/",
  "5": "https://i.meituan.com/",
  "6": "https://i.meituan.com/",
  "7": "https://main.m.taobao.com/",
  "12": "https://www.taopiaopiao.com/",
  "15": "https://vip.taobao.com/",
  "16": "https://www.fliggy.com/"
};

/* 该会场能走哪条转链通道 —— 也就是「这笔有没有你的返利」 */
export function relayChannel(a) {
  var p = String((a && a.platform) || "");
  var nm = String((a && a.activity_name) || "");
  if (p === "1" || p === "7" || p === "12" || p === "15" || p === "16") return "tb";
  if (p === "5" || p === "6") return "mt";
  if (p === "2") return "jd";
  if (/美团|外卖|闪购|吃喝玩乐|到店|团购/.test(nm)) return "mt";
  return "";
}

export function normalizeActivity(a) {
  var ch = relayChannel(a);
  var raw = a.activity_url || "";
  return {
    id: String(a.id || ""),
    activityId: String(a.activity_id || ""),
    name: a.activity_name || "",
    platform: PLATFORM_NAMES[String(a.platform)] || "活动",
    url: raw,
    /* 直达入口：原始活动页优先，其次按平台兜底，保证「进入会场」永远点得动 */
    direct: raw || PLATFORM_HOME[String(a.platform)] || "",
    pic: a.activity_pic || "",
    startTime: a.start_time || "",
    endTime: a.end_time || "",
    period: a.activity_date || "",
    promotionType: Number(a.promotion_type || 0),
    channel: ch,
    rebate: !!ch
  };
}

/* 活动列表：活动中心数据源 */
export async function hdkActivityList(env, page, keyword) {
  page = page || 1;
  var url = HDK_WWW + "/openapi/activity_list?p=" + page +
    "&keyword=" + encodeURIComponent(keyword || "") +
    "&cat_id=111&promotion_type=0&order=1";
  var res = await fetch(url);
  var json = await res.json();
  var list = json && Array.isArray(json.data) ? json.data : [];
  return list.map(normalizeActivity);
}

/* 淘宝会场转链：createConference_code 返回归因链接 + 淘口令 + 短链（失败自动重试一次，防好单库限流） */
async function tbConference(env, activityId, activityUrl, title) {
  if (!env.HDK_TB_NAME || !(activityId || activityUrl)) return null;
  var body = new URLSearchParams({
    apikey: env.HDK_APIKEY,
    pid: env.HDK_PID || "",
    tb_name: env.HDK_TB_NAME,
    title: title
  });
  if (activityId) body.set("activity_id", String(activityId));
  else body.set("activity_url", String(activityUrl));

  for (var attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise(function (r) { setTimeout(r, 700); });
    try {
      var res = await fetch("http://v2.api.haodanku.com/createConference_code", { method: "POST", body: body });
      var j = await res.json();
      if (j && (j.code === 1 || j.code === 200) && j.data && j.data.url) {
        return { url: j.data.url, taoCode: j.data.tao_code || "", shortUrl: j.data.link || "" };
      }
    } catch (e) { /* 重试或放弃 */ }
  }
  return null;
}

/* 京东会场转链：优先走京东联盟官方网关（自有账号，彻底绕开好单库）；
 * 官方通道没配/失败时再试好单库；都不行则回传 needAuth 让前端给出配置引导。 */
async function jdConference(env, activityUrl, title) {
  if (!activityUrl) return null;

  /* ① 京东联盟官方万能转链（配了 JD_APP_KEY / JD_APP_SECRET / JD_SITE_ID 才生效） */
  if (jdReady(env)) {
    var o = await jdUniversal(env, activityUrl, { timeout: 6000 });
    if (o && o.url) return { url: o.url, shortUrl: o.shortUrl || "", taoCode: "", via: "jd-api" };
  }

  /* ② 好单库统一转链口（只对「官方账号」通道有效） */
  var r = await hdkJdRelink(env, activityUrl);
  if (r && r.url) return { url: r.url, shortUrl: r.shortUrl || "", taoCode: "" };

  // 区分「没授权」和其他失败：探测一次授权状态
  try {
    var res = await fetch(HDK_BASE + "/unify_jditems_link", {
      method: "POST",
      body: new URLSearchParams({ apikey: env.HDK_APIKEY, material_id: String(activityUrl) })
    });
    var j = await res.json();
    if (j && Number(j.code) === 500 && /未开通/.test(String(j.msg || ""))) {
      return { needAuth: true, authUrl: "https://union.jd.com/proManager/custompromotion" };
    }
  } catch (e) { /* ignore */ }
  return null;
}

/* ---- 会场/红包「固定链接」缓存 ----
 * 会场入口转链一次就够了：同一个活动在整个活动周期用的是同一条推广链接，
 * 没必要每次点击都重新转 —— 直接复用（12 小时），既快又省上游调用。
 * 实时性强的（实时线报、商品、好价榜）一律保持实时转链，绝不走这里。 */
var CONF_TTL = 43200;
var _confMem = new Map();   // 无 Cache API 的环境（本地 dev-api）用内存兜底，行为保持一致
function confReq(k) { return new Request("https://wool-cache.internal/conf/" + encodeURIComponent(k)); }
async function confMatch(k) {
  var m = _confMem.get(k);
  if (m && m.exp > Date.now()) return m.v;
  if (m) _confMem.delete(k);
  try {
    if (typeof caches === "undefined") return null;
    var r = await caches.default.match(confReq(k));
    if (!r) return null;
    var j = await r.json();
    return j && j.url ? j : null;
  } catch (e) { return null; }
}
async function confPut(k, v) {
  _confMem.set(k, { v: v, exp: Date.now() + CONF_TTL * 1000 });
  try {
    if (typeof caches === "undefined") return;
    await caches.default.put(confReq(k), new Response(JSON.stringify(v), {
      headers: { "cache-control": "public, max-age=" + CONF_TTL }
    }));
  } catch (e) { /* 写缓存失败不影响主流程 */ }
}

/* ---- 固定推广链接（自有账号通道）----
 * 好单库开放平台的京东转链只服务「官方账号」通道（返回「未开通京东官方账号」）；
 * 自有账号（自己的京东联盟 / 拼多多 / 抖音）要去好单库后台「立即推广 → 输入渠道标识」手动生成推广链接。
 * 把生成好的链接配到环境变量（LINK_JD_MAIN / LINK_JD_RED / LINK_JD_WM / LINK_PDD / LINK_DY），
 * 对应会场卡就直连它 —— 一点就是你的推广链接，返利算你的，跟官方账号无关。
 */
function fixedLink(env, name, platform) {
  env = env || {};
  var hay = String(name || "") + " " + String(platform || "");
  if (/京东|京享/.test(hay)) {
    if (/京享|红包/.test(hay) && env.LINK_JD_RED) return env.LINK_JD_RED;
    if (/外卖/.test(hay) && env.LINK_JD_WM) return env.LINK_JD_WM;
    return env.LINK_JD_MAIN || "";
  }
  if (/拼多多|多多/.test(hay)) return env.LINK_PDD || "";
  if (/抖音/.test(hay)) return env.LINK_DY || "";
  return "";
}

/* 给前端用的「我的固定推广链接」清单（红包按钮、口令复制都从这里取）。
 * 这些都是推广链接，本来就是给人点的，暴露无风险；密钥不在这里。 */
export function fixedLinks(env) {
  env = env || {};
  return {
    jdMain: env.LINK_JD_MAIN || "",
    jdRed: env.LINK_JD_RED || "",
    jdWm: env.LINK_JD_WM || "",
    pdd: env.LINK_PDD || "",
    dy: env.LINK_DY || "",
    jdRedWord: env.JD_RED_WORD || "",
    channel: hdkChannel(env),
    jdApi: jdReady(env)     // 京东联盟官方通道是否就绪（就绪则京东所有链接都能自动转）
  };
}

/**
 * 会场转链总入口：把活动入口换成「带你返利标识」的推广链接。
 * 通道优先级：固定推广链接（自有账号）→ 淘宝 → 美团 → 京东；
 * 都失败时降级到原始活动页/官方入口（保证点得动）。
 * 转链成功的结果按 活动ID/URL 固定缓存，下次直接复用（opts.fresh = true 可强制重转）。
 * 返回 { url, taoCode, shortUrl, channel, rebate, note, needAuth, authUrl }
 */
export async function relayActivity(env, opts) {
  opts = opts || {};
  var aid = String(opts.activityId || "");
  var raw = String(opts.activityUrl || "");
  var name = String(opts.title || "双11红包会场");
  if (name.length < 8) name = name + "会场入口领取";

  var ck = aid || raw || name;
  if (opts.fresh !== true) {
    var cached = await confMatch(ck);
    if (cached) { cached.cached = true; return cached; }
  }

  /* ① 首选：用户后台生成的固定推广链接（京东/拼多多/抖音走这里） */
  var fx = fixedLink(env, name, opts.platform);
  if (fx) {
    var fo = { url: fx, channel: "fixed", rebate: true, note: "已用你的专属推广链接打开" };
    await confPut(ck, fo);
    return fo;
  }

  var order = ["tb", "mt", "jd"];
  var ch = String(opts.channel || "");
  if (ch === "mt") order = ["mt", "tb", "jd"];
  else if (ch === "jd") order = ["jd", "tb", "mt"];

  for (var i = 0; i < order.length; i++) {
    var c = order[i];
    var r = null;
    if (c === "tb") r = await tbConference(env, aid, raw, name);
    else if (c === "mt") {
      var mu = aid ? await hdkMeituanLink(env, aid, 1) : "";
      if (mu) r = { url: mu, taoCode: "", shortUrl: "" };
    } else if (c === "jd") r = await jdConference(env, raw, name);

    if (r && r.needAuth) {
      /* 好单库开放平台的京东转链只认「官方账号」；自有账号的推广链接要在好单库后台生成后配到 LINK_JD_* */
      return { url: "", channel: "jd", rebate: false, needAuth: true, authUrl: r.authUrl,
        note: "这个京东会场还没配你的推广链接。到好单库后台「立即推广 → 输入渠道标识」生成链接后，填入站点配置即可直达你的返利链接" };
    }
    if (r && r.url) {
      var out = { url: r.url, taoCode: r.taoCode || "", shortUrl: r.shortUrl || "", channel: c, rebate: true };
      await confPut(ck, out);   // 固定链接：转一次，之后一直复用
      return out;
    }
  }

  /* 最后兜底：没有任何返利通道时，也要保证「进入会场」点得动（直达原活动页/官方入口） */
  var direct = String(opts.direct || raw || "");
  if (direct) {
    return { url: direct, channel: "direct", rebate: false, note: "已为你打开活动会场（这个会场暂无专属优惠通道）" };
  }
  return { url: "", channel: "", rebate: false, note: "该会场暂时没有可用链接，换个会场看看" };
}

/* 兼容旧调用名 */
export const hdkConference = relayActivity;

/* ---------- 小工具：并发池 + 超时包装 ---------- */
export function withTimeout(p, ms, tag) {
  return Promise.race([
    Promise.resolve(p),
    new Promise((_, rej) => setTimeout(() => rej(new Error((tag || "请求") + " 超时")), ms))
  ]);
}

export async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { await fn(items[k], k); } catch (e) { /* 单项失败不影响其余 */ }
    }
  }));
}

/**
 * 批量核验会场「是否真能生成带你自己推广标识的链接」，据此决定卡片上的「专属优惠」标 ——
 * 不能只看平台码猜（例如淘票票/淘宝闪购虽然平台码属阿里系，但活动物料不可转链）。
 * 并发 5 路 + 单项 6 秒超时，只核验实际展示的条目，结果随 /api/activities 缓存。
 */
export async function verifyActivities(env, list, limit) {
  var items = (list || []).slice(0, limit || 12);
  // 先全部清零（normalizeActivity 里的 rebate 是启发式预估，未经实测的一律不打标）
  (list || []).forEach(function (a) { a.rebate = false; delete a.needAuth; });
  await pool(items, 6, async function (a) {
    /* 有固定推广链接（自己后台生成的京东/拼多多/抖音链接）→ 直接算能拿返利，不用再核 */
    if (fixedLink(env, a.name, a.platform)) { a.rebate = true; a.channel = "fixed"; return; }
    if (!a.channel) { a.rebate = false; return; }
    try {
      if (a.channel === "tb") {
        a.rebate = !!(await withTimeout(tbConference(env, a.activityId, a.url, (a.name || "活动") + "会场入口领取"), 5000, "tb转链"));
      } else if (a.channel === "mt") {
        a.rebate = !!(a.activityId && (await withTimeout(hdkMeituanLink(env, a.activityId, 1), 5000, "mt转链")));
      } else if (a.channel === "jd") {
        /* 京东：没配上推广链接就是「未配返利」——先给默认值，免得核验超时后变成一张没标的灰卡 */
        a.rebate = false;
        a.needAuth = true;
        var r = await withTimeout(jdConference(env, a.url, a.name), 6000, "jd转链");
        if (r && r.url) { a.rebate = true; a.needAuth = false; }
      }
    } catch (e) { a.rebate = false; }
  });
  return list;
}

/* ================= 本地生活（美团 CPS，走好单库，免费）=================
 * 好单库开放平台自带「美团活动列表 + 美团转链」，只要 HDK_APIKEY 已开通外卖权限即可，
 * 无需第三方平台凭据。实测返回：red_activity（长期红包）/ time_activity（限时活动）。
 */

export async function hdkMeituanActivities(env) {
  var url = HDK_BASE + "/meituan_activity_list?apikey=" + encodeURIComponent(env.HDK_APIKEY);
  try {
    var res = await fetch(url);
    var j = await res.json();
    if (!j || Number(j.code) !== 200 || !j.data) return null;
    return j.data;
  } catch (e) { return null; }
}

/* 渠道标识：好单库后台「点立即推广 → 输入渠道标识」用的那个值。
 * 配到环境变量 HDK_CHANNEL（默认 yangmao），转出来的链接就归属到你的渠道。 */
function hdkChannel(env) { return String((env && env.HDK_CHANNEL) || "yangmao"); }

export async function hdkMeituanLink(env, activityId, linkType) {
  var types = linkType ? [linkType] : [1, 2, 3];
  for (var i = 0; i < types.length; i++) {
    var body = new URLSearchParams({
      apikey: env.HDK_APIKEY,
      activity_id: String(activityId),
      link_type: String(types[i]),
      channel: hdkChannel(env)
    });
    try {
      var res = await fetch(HDK_BASE + "/meituan_ratesurl", { method: "POST", body: body });
      var j = await res.json();
      if (j && Number(j.code) === 200 && j.data && j.data.url) return j.data.url;
    } catch (e) { /* 换下一种链接类型 */ }
  }
  // 全部失败：可能是好单库限流，歇 700ms 再补试一次主类型
  await new Promise(function (r) { setTimeout(r, 700); });
  try {
    var res2 = await fetch(HDK_BASE + "/meituan_ratesurl", {
      method: "POST",
      body: new URLSearchParams({ apikey: env.HDK_APIKEY, activity_id: String(activityId), link_type: String(types[0]), channel: hdkChannel(env) })
    });
    var j2 = await res2.json();
    if (j2 && Number(j2.code) === 200 && j2.data && j2.data.url) return j2.data.url;
  } catch (e) { /* 放弃 */ }
  return "";
}

/* 美团活动 → 前端统一卡片结构（不暴露任何佣金字段） */
export function normalizeMeituanActivity(a) {
  var name = a.activity_name || "美团活动";
  var cat = /闪购/.test(name) ? "美团闪购" : (/外卖|美食/.test(name) ? "外卖红包" : "美团优惠");
  return {
    id: "mt:" + (a.activity_id || ""),
    name: name,
    cat: cat,
    icon: /闪购/.test(name) ? "🛒" : (/外卖|美食/.test(name) ? "🍜" : "🎫"),
    image: a.activity_image || "",
    desc: a.activity_desc_private || "领券下单更划算",
    src: "meituan"
  };
}

/* 活动中心的本地生活会（/openapi/activity_list?cat_id=111）→ 统一卡片结构 */
export function normalizeLifeActivity(a) {
  var nm = a.name || "本地生活优惠";
  var cat, icon;
  if (/闪购/.test(nm)) { cat = "美团闪购"; icon = "🛒"; }
  else if (/外卖|美食|吃|餐饮/.test(nm)) { cat = "外卖红包"; icon = "🍜"; }
  else if (/电影|影票|票/.test(nm)) { cat = "电影票"; icon = "🎬"; }
  else if (/酒店|旅行|度假|门票/.test(nm)) { cat = "出行旅行"; icon = "🏨"; }
  else { cat = "到店优惠"; icon = "🎫"; }
  return {
    id: "mt:" + (a.activityId || ""),
    name: nm,
    cat: cat,
    icon: icon,
    image: a.pic || "",
    desc: "点「获取优惠链接」生成你的专属链接，领券下单更划算",
    src: "activity"
  };
}

/* ================= 实时线报广场 ================= */

var WIRE_PLATFORM = { "1": "淘宝", "2": "京东", "3": "飞猪" };

/* 线报分类：全部/飞猪旅行/淘宝百亿补贴/淘宝实时线报/京东实时线报 */
export async function hdkWireCategories() {
  var res = await fetch(HDK_WWW + "/HolidayActivity/wire_category", {
    headers: { "x-requested-with": "XMLHttpRequest" }
  });
  var json = await res.json();
  var list = json && json.data ? json.data : [];
  return list.map(function (c) {
    return { id: String(c.type_id), name: c.type_name };
  });
}

/* 线报列表 */
export function normalizeWire(w) {
  var lines = (w.list || []).map(function (l) {
    return {
      text: l.content || "",
      couponUrl: l.coupon_url || "",
      itemId: l.item_id || ""
    };
  });
  return {
    id: String(w.wire_id || ""),
    category: w.cate_id || "",
    platform: WIRE_PLATFORM[String(w.platform)] || "淘宝",
    time: w.starttime || "",
    images: (w.images || []).slice(0, 3),
    lines: lines
  };
}

export async function hdkWireReport(type, page) {
  var url = HDK_WWW + "/HolidayActivity/wire_report?page_no=" + (page || 1) +
    "&page_size=20&type=" + (type || 0) + "&is_images=1";
  var res = await fetch(url, { headers: { "x-requested-with": "XMLHttpRequest" } });
  var json = await res.json();
  var data = json && json.data ? json.data : {};
  return {
    total: Number(data.total || 0),
    items: (data.items || []).map(normalizeWire)
  };
}

/* 好单库线报时间格式 "2026-10-16 11:43:25"（北京时间，无时区后缀）→ 毫秒时间戳。
 * 必须按 +08:00 解析，否则 Worker 的 UTC 环境会整体错 8 小时，24 小时窗口就废了。 */
export function parseWireTime(s) {
  var m = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5], +m[6]);
}

/**
 * 滚动窗口线报：并发分批翻页（每页 20 条），按 starttime 过滤出「最近 N 小时 + 最多 M 条」。
 *  ·
 *  ·  为什么要限两条线（时间 + 条数）：
 *  ·    - 全部/百亿补贴/淘宝实时/京东实时  流很快，限 12~24 小时 + 200 条，避免一次拉几百条把页面拖卡；
 *  ·    - 飞猪旅行                            更新慢，窗口放宽到 7 天，但只保留最新 100 条；
 *  ·    - 24 小时前（或超出条数上限）的自动下线，最新的一定排在最前面。
 *  ·
 *  ·  翻页是自适应的：收够条数、或整批都早于窗口、或上游翻到底了就立刻收手，绝不空拉。
 *  ·  再加一道「总时间预算」：Cloudflare 边缘到好单库偶尔一次要好几秒，
 *  ·  翻页一多就把用户晾在那儿了 —— 超预算就收手，有多少返多少（前端照样有内容）。
 *  ·  返回 { items, total, shown, hours, max, since, until }
 */
export async function hdkWireReportRecent(type, hours, max, budgetMs) {
  hours = Math.min(Math.max(Number(hours) || 12, 1), 720);
  max = Math.min(Math.max(Number(max) || 200, 20), 300);
  var cutoff = Date.now() - hours * 3600 * 1000;
  var deadline = Date.now() + Math.min(Math.max(Number(budgetMs) || 8000, 1500), 25000);
  var MAXP = 30, BATCH = 8;    // 并发提到 8：批数少了，等待轮次也少了
  var row = [];     // { it, t }
  var total = 0;

  function inWindowUnique() {
    var seen = {}, n = 0;
    row.forEach(function (x) {
      if (x.t && x.t < cutoff) return;
      if (seen[x.it.id]) return;
      seen[x.it.id] = 1; n++;
    });
    return n;
  }

  for (var start = 1; start <= MAXP; start += BATCH) {
    if (start > 1 && Date.now() >= deadline) break;   // 预算用完，立刻收手
    var nums = [];
    for (var i = start; i < start + BATCH && i <= MAXP; i++) nums.push(i);
    var res = [];
    await pool(nums, BATCH, async function (p) {
      try {
        /* 单页最多等 5 秒：一页卡死不能把整个请求拖垮 */
        var r = await withTimeout(hdkWireReport(type, p), 5000, "页" + p);
        if (r) res.push({ p: p, r: r });
      } catch (e) { /* 单页失败跳过 */ }
    });
    if (!res.length) break;
    res.sort(function (a, b) { return a.p - b.p; });
    if (start === 1 && res[0].r) total = res[0].r.total || 0;

    var batchAllOld = true, got = 0;
    res.forEach(function (x) {
      (x.r.items || []).forEach(function (it) {
        got++;
        var t = parseWireTime(it.time);
        row.push({ it: it, t: t });
        if (!t || t >= cutoff) batchAllOld = false;   // 时间缺失的当新数据留着
      });
    });

    if (got === 0) break;                              // 上游翻到底了
    if (inWindowUnique() >= max) break;                 // 已收够条数
    if (batchAllOld) break;                             // 整批早于窗口 → 后面只会更早
  }

  var seen = {};
  var items = [];
  row.forEach(function (x) {
    if (x.t && x.t < cutoff) return;
    if (seen[x.it.id]) return;
    seen[x.it.id] = 1;
    x.it.ts = x.t;
    items.push(x.it);
  });
  items.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
  if (items.length > max) items = items.slice(0, max);   // 最新靠在最前

  return {
    items: items,
    total: total,
    shown: items.length,
    hours: hours,
    max: max,
    since: cutoff,
    until: Date.now()
  };
}

/* ================= 素材线报（宠物/美妆） ================= */

/* 素材标签：爆款/宠物/母婴/美妆/线报 */
export async function hdkMaterialTags() {
  var res = await fetch(HDK_WWW + "/CommunityMaterial/tags", {
    headers: { "x-requested-with": "XMLHttpRequest" }
  });
  var json = await res.json();
  var list = json && json.data && json.data.list ? json.data.list : [];
  return list.map(function (t) { return t.name; });
}

/* 按标签取素材圈子（宠物/美妆…），优先 choice=1 的推荐圈 */
export async function hdkMaterialCommunities(tag) {
  var url = HDK_WWW + "/CommunityMaterial/getCommunityList?type=1&page=1&tag=" + encodeURIComponent(tag);
  var res = await fetch(url, { headers: { "x-requested-with": "XMLHttpRequest" } });
  var json = await res.json();
  var list = json && json.data && json.data.list ? json.data.list : [];
  var picked = list.filter(function (c) { return c.choice === 1; });
  var pool = picked.length ? picked : list;
  return pool.slice(0, 2).map(function (c) {
    return { id: c.community_id, name: c.show_name };
  });
}

/* 圈子内商品列表（淘系 token 物料，可走 ratesurl 转链） */
export async function hdkMaterialItems(communityId, page) {
  var url = HDK_WWW + "/CommunityMaterial/getItemListByCommunityId?community_id=" +
    encodeURIComponent(communityId) + "&page=" + (page || 1);
  var res = await fetch(url, { headers: { "x-requested-with": "XMLHttpRequest" } });
  var json = await res.json();
  var list = json && json.data && json.data.list ? json.data.list : [];
  return list.map(function (it) {
    return {
      id: it.item_id || "",
      title: it.itemtitle || it.itemshorttitle || "",
      pic: it.itempic || "",
      price: it.itemprice || "0",
      endPrice: it.itemendprice || it.itemprice || "0",
      coupon: Number(it.couponmoney || 0),
      time: it.create_at || 0
    };
  });
}

/* ================= 省钱日报 =================
 * 口径说明：站点是纯静态 + 无账号，没法拿到真实订单，所以「省了多少」有两层：
 *  ① 全站层（服务端）：当前在架的带货优惠一共能省多少、最狠的单品是哪几个 —— 每天定时算一次；
 *  ② 个人层（前端 localStorage 埋点）：你点开过的优惠累计能省多少 —— 隐私留在本机，不上传。
 * 两层在「省钱日报」页合并展示。
 */

/* 北京时间日期串：2026-10-16 */
export function bjDate(ts) {
  var d = new Date((ts || Date.now()) + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

export async function dailyStats(env) {
  if (!env.HDK_APIKEY) return null;
  var feeds = await Promise.all([1, 2, 4, 6].map(function (t) {
    return hdkFeed(env, t, 50).catch(function () { return []; });
  }));

  var seen = {}, all = [];
  feeds.forEach(function (l) {
    (l || []).forEach(function (p) {
      if (!p || !p.id || seen[p.id]) return;
      seen[p.id] = 1; all.push(p);
    });
  });

  /* 脏数据过滤：秒杀类商品的「原价」常是占位值（10009 之类），会把省钱额算成天文数字 */
  var valid = all.filter(function (p) {
    var base = Number(p.price) || 0;
    return base > 0 && base < 5000 && Number(p.endPrice) > 0;
  });

  var withCoupon = valid.filter(function (p) { return Number(p.coupon) > 0; });
  var saveTotal = 0, saveToday = 0, sumPrice = 0;
  withCoupon.forEach(function (p) { saveTotal += Number(p.coupon) || 0; });
  valid.forEach(function (p) {
    var base = Number(p.price) || 0;
    var s = base - (Number(p.endPrice) || 0);
    if (s > 0) saveToday += s;
    sumPrice += base;
  });

  var top = all
    .map(function (p) {
      var off = (Number(p.price) || 0) - (Number(p.endPrice) || 0);
      return { id: p.id, title: p.title, price: p.price, endPrice: p.endPrice, coupon: Number(p.coupon) || 0, off: Math.round(off * 10) / 10, pic: p.pic };
    })
    /* 剔除脏数据：秒杀类商品的「原价」常是占位值（如 10009），会被算成省 9997 元，必须挡掉 */
    .filter(function (p) {
      var base = Number(p.price) || 0;
      return p.off > 0 && base > 0 && base < 5000 && p.off / base < 0.95 && Number(p.endPrice) > 0;
    })
    .sort(function (a, b) { return b.off - a.off; })
    .slice(0, 5);

  var wire = null;
  try { wire = await hdkWireReportRecent(0, 24); } catch (e) { wire = null; }

  var acts = [];
  try { acts = await hdkActivityList(env, 1, ""); } catch (e) { acts = []; }
  var rebateActs = acts.filter(function (a) { return a.channel; });

  return {
    date: bjDate(Date.now()),
    generatedAt: Date.now(),
    deals: all.length,
    couponDeals: withCoupon.length,
    couponSave: Math.round(saveTotal),
    instantSave: Math.round(saveToday),
    avgRate: all.length ? Math.round((saveToday / Math.max(1, all.reduce(function (s, p) { return s + (Number(p.price) || 0); }, 0))) * 1000) / 10 : 0,
    wires: wire ? wire.shown : 0,
    activities: acts.length,
    rebateActivities: rebateActs.length,
    top: top
  };
}

/* ================= 对话转链：用户发链接 → 优惠归因链接 ================= */

/**
 * 从用户消息里提取可转链的物料：
 *  - 淘宝：item.htm?id= / ?id= 数字 ID / 站内加密 token（线报同款）
 *  - 京东：item.jd.com/<sku>.html / u.jd.com 短链 / coupon.m.jd.com 券链
 *  - 飞猪等淘系 token：直接 ratesurl
 * 返回 { platform, materialId, couponUrl, kind } 或 null
 */
export function extractLinkMaterial(text) {
  var s = String(text || "");
  if (!s) return null;

  // 京东券链（优先，转链时带上）
  var jdCoupon = s.match(/https?:\/\/coupon\.m\.jd\.com\/[^\s，。！]+/);
  // 京东商品链接
  var jdItem = s.match(/https?:\/\/item\.jd\.com\/(\d+)\.html/) ||
    s.match(/https?:\/\/u\.jd\.com\/([A-Za-z0-9]+)/) ||
    s.match(/https?:\/\/[^\s，。！]*jd\.com[^\s，。！]*/);
  if (jdItem) {
    return {
      platform: "京东",
      materialId: jdItem[1] ? (jdItem[1].indexOf("http") === 0 ? jdItem[1] : jdItem[1]) : jdItem[0],
      couponUrl: jdCoupon ? jdCoupon[0] : "",
      kind: "jd"
    };
  }

  // 淘宝数字商品 ID
  var tbId = s.match(/id=(\d{6,})/);
  if (tbId) return { platform: "淘宝", materialId: tbId[1], couponUrl: "", kind: "tb" };

  // 淘系加密 token（长度 20+ 的 base62 串，含 - 分隔）
  var token = s.match(/\b([A-Za-z0-9]{10,}-[A-Za-z0-9]{10,}[A-Za-z0-9]*)\b/);
  if (token) return { platform: "淘宝", materialId: token[1], couponUrl: "", kind: "tb" };

  // 淘宝链接但提不出 ID
  if (/taobao\.com|tmall\.com|tb\.cn/i.test(s)) {
    return { platform: "淘宝", materialId: "", couponUrl: "", kind: "tb-unknown" };
  }
  return null;
}

/**
 * 凑单工具：解析用户粘贴的淘宝链接/口令 → 商品信息（加入凑单列表）。
 * 淘宝走 item_detail；京东降级为手动补价条目。
 * 返回 normalizeProduct 结果，或 { manual:true, ... } 待手补，或 null。
 */
export async function parsePastedLink(env, text) {
  var m = extractLinkMaterial(text);
  if (!m) return null;

  if (m.kind === "jd") {
    return {
      platform: "京东",
      manual: true,
      id: m.materialId || "",
      title: "京东商品",
      note: "京东商品暂时取不到详情，补一下到手价就能一起凑"
    };
  }
  if (!m.materialId || m.kind === "tb-unknown") {
    return {
      platform: m.platform || "淘宝",
      manual: true,
      id: "",
      title: "",
      note: "没识别出商品 ID，换个链接或用手动添加"
    };
  }
  var p = await hdkItemDetail(env, m.materialId);
  if (!p) {
    return { platform: "淘宝", manual: true, id: m.materialId, title: "", note: "这个商品没查到详情，可能下架了" };
  }
  return p;
}

/**
 * 对话转链主入口：把用户发来的链接/物料转成归因推广链接。
 * 佣金字段一律剥离。京东转链失败时降级返回原始链接+说明。
 */
export async function convertLink(env, text) {
  var m = extractLinkMaterial(text);
  if (!m) return null;
  /* 原始链接兜底：转不了链也要保证「点得开」——至少打开用户点的那条原链接 */
  var rawUrl = (String(text).match(/https?:\/\/[^\s"'，。）)]+/) || [""])[0];

  if (m.kind === "jd") {
    /* ① 京东联盟官方万能转链：商品页 / 会场 / u.jd.com 短链都吃得下，佣金归自己 */
    if (jdReady(env)) {
      var target = m.materialId.indexOf("http") === 0 ? m.materialId : (rawUrl || m.materialId);
      var off = await jdUniversal(env, target, { couponUrl: m.couponUrl, timeout: 8000 });
      if (off && off.url) {
        return {
          platform: "京东",
          converted: true,
          url: off.url,
          shortUrl: off.shortUrl || "",
          couponUrl: m.couponUrl,
          note: m.couponUrl ? "已转好你的京东链接，券也一起带上啦" : "已转好你的京东链接"
        };
      }
    }
    var jd = await hdkJdRelink(env, m.materialId, m.couponUrl);
    if (jd) {
      return {
        platform: "京东",
        converted: true,
        url: jd.url,
        shortUrl: jd.shortUrl,
        couponUrl: m.couponUrl,
        note: m.couponUrl ? "已转好你的京东链接，券也一起带上啦" : "已转好你的京东链接"
      };
    }
    var jdFallback = rawUrl || (m.materialId.indexOf("http") === 0 ? m.materialId : "");
    return {
      platform: "京东",
      converted: false,
      url: jdFallback,
      couponUrl: m.couponUrl,
      note: jdFallback ? "这条京东链接暂时转不了返利，先给你打开原链接" : "这条京东链接暂时转不了，换一个试试"
    };
  }

  if (m.kind === "tb-unknown" || !m.materialId) {
    return {
      platform: "淘宝",
      converted: false,
      url: rawUrl || "",
      couponUrl: "",
      note: rawUrl ? "这条链接里提不出商品 ID，先给你打开原链接" : "这个链接里提不出商品 ID，把商品链接或淘口令再发我一次试试"
    };
  }

  var relink = await hdkRelink(env, m.materialId, "用户分享好物");
  if (relink && relink.url) {
    return {
      platform: m.platform,
      converted: true,
      url: relink.url,
      taoCode: relink.taoCode,
      coupon: relink.coupon,
      couponUrl: "",
      note: relink.coupon > 0
        ? "已转好你的链接，这张券 " + relink.coupon + " 元也一起带上啦"
        : "已转好你的链接，下单直接走你的优惠通道"
    };
  }
  return {
    platform: m.platform,
    converted: false,
    url: rawUrl || "",
    couponUrl: "",
    note: rawUrl ? "这个商品暂时转不了链，先给你打开原链接" : "这个商品暂时转不了链，可能是下架了，换一个试试"
  };
}

/* ================= 图片代理 ================= */

/* 图片代理：同源输出，规避图床防盗链与跨域问题 */
export async function proxyImage(rawUrl) {
  var u = String(rawUrl || "");
  if (!/^https:\/\/([a-z0-9.-]+\.)?(alicdn\.com|fudaiapp\.com|360buyimg\.com|jd\.com|haodanku\.com|ffquan\.(cn|com))\//.test(u)) {
    return { status: 400, body: "bad url" };
  }
  var res = await fetch(u, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) return { status: res.status, body: "upstream error" };
  var buf = await res.arrayBuffer();
  return {
    status: 200,
    body: buf,
    headers: {
      "content-type": res.headers.get("content-type") || "image/jpeg",
      "cache-control": "public, max-age=86400",
      "access-control-allow-origin": "*"
    }
  };
}
