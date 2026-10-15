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

/* 京东商品转链：需京东官方账号授权（haodanku 后台 platform=2 开通）。
 * 未开通时返回 null，由调用方降级为原始链接。 */
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

var PLATFORM_NAMES = { "1": "淘宝", "2": "京东", "3": "拼多多", "4": "抖音", "5": "美团", "6": "快手" };

export function normalizeActivity(a) {
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
    promotionType: Number(a.promotion_type || 0)
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

/**
 * 会场转链（红包/活动入口归因到推广位）
 * tb_name 生效时返回归因链接+淘口令+短链；否则降级原始 activity_url。
 * 返回 { url, taoCode, shortUrl, fallback }
 */
export async function hdkConference(env, opts) {
  opts = opts || {};
  var title = String(opts.title || "双11红包会场");
  if (title.length < 8) title = title + "会场入口领取";

  if (env.HDK_TB_NAME && (opts.activityId || opts.activityUrl)) {
    var body = new URLSearchParams({
      apikey: env.HDK_APIKEY,
      pid: env.HDK_PID || "",
      tb_name: env.HDK_TB_NAME,
      title: title
    });
    if (opts.activityId) body.set("activity_id", String(opts.activityId));
    else body.set("activity_url", String(opts.activityUrl));
    try {
      var res = await fetch("http://v2.api.haodanku.com/createConference_code", { method: "POST", body: body });
      var json = await res.json();
      if (json && (json.code === 1 || json.code === 200) && json.data && json.data.url) {
        return {
          url: json.data.url,
          taoCode: json.data.tao_code || "",
          shortUrl: json.data.link || "",
          fallback: false
        };
      }
    } catch (e) { /* 落到兜底 */ }
  }
  return { url: opts.activityUrl || "", taoCode: "", shortUrl: "", fallback: true };
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

/* ================= 对话转链：用户发链接 → 返利链接 ================= */

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
 * 对话转链主入口：把用户发来的链接/物料转成归因推广链接。
 * 佣金字段一律剥离。京东未授权时降级返回原始链接+说明。
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
      note: "京东官方授权还没开通，先给你原链接，开通后自动转链"
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
