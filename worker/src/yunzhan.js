/**
 * 羊毛AIHUB · 云瞻开放平台 CPS（本地生活推广转链）
 * 文档：https://pub.yunzhanxinxi.com/cms/abutment（API对接页）
 * 域名：https://openapi.yunzhanxinxi.com
 *
 * 鉴权（文档说明页）：
 *   所有请求参数按 key 的 ascii 升序排成 key=value&key=value，
 *   字符串前后拼接 app_secret，MD5 后取 32 位小写 = sign。
 *   请求体 form-urlencoded，必带 app_key / timestamp / sign。
 *
 * 用到的接口：
 *   POST /api/business/api-list           支持API的cps业务列表
 *   POST /api/api-list/promotion-link     获取cps业务的推广链接
 *     { promotionId, userSource, linkType, business_id } → { link_url }
 *
 * 密钥（Worker secret / tools/.env 同值）：
 *   YZ_APP_KEY / YZ_APP_SECRET / YZ_PROMOTION_ID（推广位ID）
 */

const YZ_BASE = "https://openapi.yunzhanxinxi.com";

/* ================= MD5（Workers crypto.subtle 不支持 MD5，纯 JS 实现） ================= */

const MD5_T = [];
for (let i = 1; i <= 64; i++) MD5_T.push(Math.floor(Math.abs(Math.sin(i)) * 4294967296) | 0);
const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

export function md5(str) {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length;
  const nWords = ((((len + 8) >> 6) + 1) << 4); // 补齐到 64 字节整数倍
  const x = new Array(nWords).fill(0);
  for (let i = 0; i < len; i++) x[i >> 2] |= bytes[i] << ((i % 4) * 8);
  const bitLen = len * 8;
  x[bitLen >>> 5] |= 0x80 << (bitLen % 32);
  x[nWords - 2] = bitLen;
  x[nWords - 1] = Math.floor(bitLen / 4294967296);

  let a0 = 1732584193, b0 = -271733879, c0 = -1732584194, d0 = 271733878;

  for (let i = 0; i < nWords; i += 16) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let j = 0; j < 64; j++) {
      let F, k;
      if (j < 16) { F = (B & C) | (~B & D); k = j; }
      else if (j < 32) { F = (B & D) | (C & ~D); k = (5 * j + 1) % 16; }
      else if (j < 48) { F = B ^ C ^ D; k = (3 * j + 5) % 16; }
      else { F = C ^ (B | ~D); k = (7 * j) % 16; }
      F = (F + A + MD5_T[j] + (x[i + k] || 0)) | 0;
      const sh = MD5_S[(j >> 4) * 4 + (j % 4)];
      A = D; D = C; C = B;
      B = (B + (((F << sh) | (F >>> (32 - sh))))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  return [a0, b0, c0, d0].map(function (n) {
    let s = "", v;
    for (let j = 0; j < 4; j++) {
      v = (n >>> (j * 8)) & 255;
      s += (v < 16 ? "0" : "") + v.toString(16);
    }
    return s;
  }).join("");
}

/* ================= 签名与请求 ================= */

/** 云瞻签名：参数按 key ascii 升序 k=v& 拼接，前后包 app_secret，MD5 32位小写 */
export function yzSign(params, appSecret) {
  const keys = Object.keys(params).sort();
  const str = keys.map(function (k) { return k + "=" + params[k]; }).join("&");
  return md5(appSecret + str + appSecret);
}

/** 通用 POST（form-urlencoded，自动补 app_key/timestamp/sign）。成功返回 data，失败返回 null */
async function yzPost(env, path, biz) {
  const appKey = env.YZ_APP_KEY;
  const secret = env.YZ_APP_SECRET;
  if (!appKey || !secret) return null;
  const params = {};
  Object.keys(biz || {}).forEach(function (k) { params[k] = String(biz[k]); });
  params.app_key = appKey;
  params.timestamp = String(Math.floor(Date.now() / 1000));
  params.sign = yzSign(params, secret);

  const r = await fetch(YZ_BASE + path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString()
  });
  const j = await r.json().catch(function () { return null; });
  if (!j || j.status !== true) return null;
  return j.data || null;
}

/* ================= 业务列表（内存缓存 10 分钟） ================= */

let bizListCache = { data: null, expire: 0 };

/** 支持API的cps业务列表（原始）。未配置密钥或请求失败返回 [] */
export async function yzBusinessList(env) {
  if (!env.YZ_APP_KEY || !env.YZ_APP_SECRET) return [];
  if (bizListCache.data && bizListCache.expire > Date.now()) return bizListCache.data;
  const data = await yzPost(env, "/api/business/api-list", {});
  const list = (data && data.businessList) || [];
  bizListCache = { data: list, expire: Date.now() + 600000 };
  return list;
}

/* ---- 本地生活业务筛选：排除淘宝/京东（站内已覆盖），按热度关键词挑 ---- */
const LIFE_GROUPS = [
  { cat: "美团", icon: "🍜", keys: ["美团"] },
  { cat: "饿了么", icon: "🥡", keys: ["饿了么"] },
  { cat: "电影票", icon: "🎬", keys: ["电影", "影票"] },
  { cat: "打车出行", icon: "🚕", keys: ["打车", "出行", "滴滴"] },
  { cat: "酒店民宿", icon: "🏨", keys: ["酒店", "民宿"] },
  { cat: "卡券充值", icon: "💳", keys: ["卡券", "话费", "充值", "加油"] },
  { cat: "大牌点餐", icon: "🍱", keys: ["点餐", "霸王餐", "美食"] }
];
const EXCLUDE_KEYS = ["淘宝", "京东", "天猫", "拼多多"];

/** 挑出来的热门本地生活业务（去重、每组最多 2 条、总共约 10 条） */
export async function yzLifeBusinesses(env) {
  const raw = await yzBusinessList(env);
  const seen = {};
  const out = [];
  for (const g of LIFE_GROUPS) {
    let n = 0;
    for (const b of raw) {
      if (n >= 2) break;
      const name = String(b.name || "");
      if (!name || seen[name]) continue;
      if (EXCLUDE_KEYS.some(function (k) { return name.indexOf(k) > -1; })) continue;
      if (!g.keys.some(function (k) { return name.indexOf(k) > -1; })) continue;
      seen[name] = 1;
      out.push({
        id: b.id,
        name: name,
        cat: g.cat,
        icon: g.icon,
        commission: b.commission_rate_text || "",
        linkType: 1
      });
      n++;
    }
  }
  return out;
}

/* ================= 推广链接 ================= */

/**
 * 获取某个 CPS 业务的推广链接。
 * linkType: 1=短链接 2=长链接 3=二维码（默认短链，最通用）。
 * 返回链接字符串；失败返回 null。
 */
export async function yzPromotionLink(env, businessId, linkType) {
  if (!env.YZ_PROMOTION_ID) return null;
  const data = await yzPost(env, "/api/api-list/promotion-link", {
    promotionId: env.YZ_PROMOTION_ID,
    userSource: "ymhub",
    linkType: String(linkType || 1),
    business_id: String(businessId)
  });
  return (data && data.link_url) || null;
}
