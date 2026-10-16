/**
 * 羊毛AIHUB 共享核心 — Cloudflare Worker 与本地开发代理共用
 * 铁律：normalizeProduct / normalizeActivity / normalizeWire / convertLink 只输出前端可见字段，
 *       佣金类字段（tkrates/tkmoney/max_commission_rate/commission）永不外泄。
 * 数据源对前端不可见，统一呈现为「AI 智能选品」。
 */

export const HDK_BASE = "https://v3.api.haodanku.com";
export const HDK_WWW = "https://www.haodanku.com";

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
  return {
    id: String(a.id || ""),
    activityId: String(a.activity_id || ""),
    name: a.activity_name || "",
    platform: PLATFORM_NAMES[String(a.platform)] || "活动",
    url: a.activity_url || "",
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

/* 淘宝会场转链：createConference_code 返回归因链接 + 淘口令 + 短链 */
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
  try {
    var res = await fetch("http://v2.api.haodanku.com/createConference_code", { method: "POST", body: body });
    var j = await res.json();
    if (j && (j.code === 1 || j.code === 200) && j.data && j.data.url) {
      return { url: j.data.url, taoCode: j.data.tao_code || "", shortUrl: j.data.link || "" };
    }
  } catch (e) { /* 试下一条通道 */ }
  return null;
}

/* 京东会场转链：未开通京东官方授权时明确回传 needAuth，前端据此提示用户去开通 */
async function jdConference(env, activityUrl, title) {
  if (!activityUrl) return null;
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
      return { needAuth: true, authUrl: "https://publish.haodanku.com/Promotioncenter/auth?platform=2" };
    }
  } catch (e) { /* ignore */ }
  return null;
}

/**
 * 会场转链总入口：把活动入口换成「带你返利标识」的推广链接。
 * 通道优先级：淘宝 → 美团 → 京东；都失败时降级到原始活动页并明示「无返利」。
 * 返回 { url, taoCode, shortUrl, channel, rebate, note, needAuth, authUrl }
 */
export async function relayActivity(env, opts) {
  opts = opts || {};
  var aid = String(opts.activityId || "");
  var raw = String(opts.activityUrl || "");
  var name = String(opts.title || "双11红包会场");
  if (name.length < 8) name = name + "会场入口领取";

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
      return { url: "", channel: "jd", rebate: false, needAuth: true, authUrl: r.authUrl,
        note: "京东返利还没开通授权，点下方按钮 1 分钟开通后即可拿返利" };
    }
    if (r && r.url) {
      return { url: r.url, taoCode: r.taoCode || "", shortUrl: r.shortUrl || "", channel: c, rebate: true };
    }
  }

  if (raw) return { url: raw, channel: "raw", rebate: false, note: "该会场暂未开通返利，已为你打开原活动页" };
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
  await pool(items, 5, async function (a) {
    if (!a.channel) { a.rebate = false; return; }
    try {
      if (a.channel === "tb") {
        a.rebate = !!(await withTimeout(tbConference(env, a.activityId, a.url, (a.name || "活动") + "会场入口领取"), 6000, "tb转链"));
      } else if (a.channel === "mt") {
        a.rebate = !!(a.activityId && (await withTimeout(hdkMeituanLink(env, a.activityId, 1), 6000, "mt转链")));
      } else if (a.channel === "jd") {
        var r = await withTimeout(jdConference(env, a.url, a.name), 6000, "jd转链");
        a.rebate = !!(r && r.url);
        a.needAuth = !!(r && r.needAuth);
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

export async function hdkMeituanLink(env, activityId, linkType) {
  var types = linkType ? [linkType] : [1, 2, 3];
  for (var i = 0; i < types.length; i++) {
    var body = new URLSearchParams({
      apikey: env.HDK_APIKEY,
      activity_id: String(activityId),
      link_type: String(types[i]),
      channel: "ck_hub"
    });
    try {
      var res = await fetch(HDK_BASE + "/meituan_ratesurl", { method: "POST", body: body });
      var j = await res.json();
      if (j && Number(j.code) === 200 && j.data && j.data.url) return j.data.url;
    } catch (e) { /* 换下一种链接类型 */ }
  }
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

  if (m.kind === "jd") {
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
    return {
      platform: "京东",
      converted: false,
      url: m.materialId.indexOf("http") === 0 ? m.materialId : "",
      couponUrl: m.couponUrl,
      note: "这个京东链接暂时转不了，先打开原链接看看吧"
    };
  }

  if (m.kind === "tb-unknown" || !m.materialId) {
    return {
      platform: "淘宝",
      converted: false,
      url: "",
      couponUrl: "",
      note: "这个链接里提不出商品 ID，把商品链接或淘口令再发我一次试试"
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
    url: "",
    couponUrl: "",
    note: "这个商品暂时转不了链，可能是下架了，换一个试试"
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
