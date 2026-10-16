/**
 * 羊毛AIHUB · 京东联盟官方通道（直连 api.jd.com，绕开好单库）
 *
 * 为什么要有这个文件：
 *   好单库开放平台的京东转链接口 unify_jditems_link 只服务「官方账号」通道，
 *   自有账号（自己的京东联盟）授权怎么配都绕不过（实测穷举 13+ 种参数全被拒）。
 *   而京东联盟自己的开放网关是完全开放的 —— 只要你有一个京东联盟应用，
 *   就能用自己的 appKey / secretKey / siteId 直接转链，佣金 100% 归自己，
 *   而且能转「任意」京东链接（商品、会场、线报里的商品），也就是官方那个万能转链。
 *
 * 需要配 3 个值（都在 union.jd.com 里拿，见 wrangler.toml 注释）：
 *   JD_APP_KEY    应用 appKey
 *   JD_APP_SECRET 应用 secretKey（保密，用 wrangler secret put）
 *   JD_SITE_ID    推广位 ID（网站ID / APP ID / 导购媒体ID）
 * 可选：
 *   JD_SUB_UNION_ID  子推广位（渠道标识），用来区分流量来源
 *   JD_PID           推广位 PID（与 siteId 二选一，有的账号走这个）
 *
 * 三个值没配齐时本模块整体静默失效（jdReady=false），调用方自动降级，
 * 不影响任何现有功能。
 */

/* ---------- 纯 JS MD5 ----------
 * Workers 的 crypto.subtle 不支持 MD5，而京东宙斯网关的签名算法就是
 * md5(appSecret + 参数按字母序拼接 + appSecret) 转大写，所以得自己带一个。
 * 返回大写 hex —— 京东要求大写，不用再转。 */
function md5(input) {
  var bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  var len = bytes.length;
  var bitLen = len * 8;
  var total = (((len + 8) >> 6) + 1) * 64;
  var buf = new Uint8Array(total);
  buf.set(bytes);
  buf[len] = 0x80;
  var dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, bitLen >>> 0, true);
  dv.setUint32(total - 4, Math.floor(bitLen / 4294967296), true);

  var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  var S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  var K = new Uint32Array(64);
  for (var i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;

  for (var off = 0; off < total; off += 64) {
    var M = new Uint32Array(16);
    for (var j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);
    var A = a0, B = b0, C = c0, D = d0;
    for (var k = 0; k < 64; k++) {
      var F, g;
      if (k < 16) { F = (B & C) | (~B & D); g = k; }
      else if (k < 32) { F = (D & B) | (~D & C); g = (5 * k + 1) % 16; }
      else if (k < 48) { F = B ^ C ^ D; g = (3 * k + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * k) % 16; }
      F = (F + A + K[k] + M[g]) >>> 0;
      A = D; D = C; C = B;
      var sh = S[(k >> 4) * 4 + (k % 4)];
      B = (B + ((F << sh) | (F >>> (32 - sh)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }

  var out = new Uint8Array(16);
  var odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true); odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true); odv.setUint32(12, d0, true);
  var hex = "";
  for (var n = 0; n < 16; n++) hex += ("0" + out[n].toString(16)).slice(-2);
  return hex.toUpperCase();
}

export { md5 };

/* ---------- 网关基础 ---------- */
var GW = "https://api.jd.com/routerjson";
/* 京东服务端允许 10 分钟时钟误差；统一按北京时间出时间戳，避免跨时区被判超时 */
function jdStamp() {
  var d = new Date(Date.now() + 8 * 3600 * 1000);
  function p(n) { return String(n).padStart(2, "0"); }
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) +
    " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
}

export function jdReady(env) {
  return !!(env && env.JD_APP_KEY && env.JD_APP_SECRET && (env.JD_SITE_ID || env.JD_PID));
}

/* 签名：参数按字母序 → 拼 key+value → 两端夹 appSecret → MD5 → 大写 */
function jdSign(params, secret) {
  var keys = Object.keys(params).sort();
  var s = secret;
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i], v = params[k];
    if (v === undefined || v === null || v === "") continue;
    s += k + v;
  }
  s += secret;
  return md5(s);
}

/* 调一次网关，返回 { ok, code, desc, data } */
async function jdInvoke(env, method, biz, timeoutMs) {
  var params = {
    method: method,
    app_key: String(env.JD_APP_KEY),
    timestamp: jdStamp(),
    format: "json",
    v: "1.0",
    sign_method: "md5",
    "360buy_param_json": JSON.stringify(biz)
  };
  if (env.JD_ACCESS_TOKEN) params.access_token = String(env.JD_ACCESS_TOKEN);
  params.sign = jdSign(params, String(env.JD_APP_SECRET));

  var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  var timer = ctrl && timeoutMs ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
  try {
    var res = await fetch(GW, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: ctrl ? ctrl.signal : undefined
    });
    if (timer) clearTimeout(timer);
    var raw = await res.text();
    var json = null;
    try { json = JSON.parse(raw); } catch (e) { json = null; }
    if (!json) return { ok: false, code: "bad-json", desc: String(raw).slice(0, 160) };

    var node = json[method.replace(/\./g, "_") + "_response"];
    if (!node) node = json.error_response;
    if (!node) {
      for (var kk in json) { if (String(kk).indexOf("_response") > -1) { node = json[kk]; break; } }
    }
    if (!node) return { ok: false, code: "no-node", desc: raw.slice(0, 160) };

    if (node.code && String(node.code) !== "200") {
      return { ok: false, code: String(node.code), desc: String(node.zh_desc || node.en_desc || node.msg || "") };
    }
    var data = node.data;
    if (typeof data === "string") { try { data = JSON.parse(data); } catch (e) { data = null; } }
    if (!data) return { ok: false, code: "no-data", desc: raw.slice(0, 160) };
    if (data.code && String(data.code) !== "200") {
      return { ok: false, code: String(data.code), desc: String(data.message || data.msg || "") };
    }
    return { ok: true, data: data.data || data };
  } catch (e) {
    if (timer) clearTimeout(timer);
    return { ok: false, code: "network", desc: String((e && e.message) || e) };
  }
}

/* ---------- 万能转链 ----------
 * 京东联盟官方「万能转链」= jd.union.open.promotion.bysubunionid.get，
 * 传什么链接就转什么链接：商品详情页、活动会场、短链 u.jd.com 都吃。
 * 备选 jd.union.open.promotion.common.get（部分账号只开了这个）。
 * 返回 { url, shortUrl, channel, method } 或 null。 */
export async function jdUniversal(env, materialUrl, opts) {
  opts = opts || {};
  if (!jdReady(env) || !materialUrl) return null;

  var req = {
    materialId: String(materialUrl),
    siteId: String(env.JD_SITE_ID || ""),
    positionId: Number(opts.positionId || 0),
    subUnionId: String(env.JD_SUB_UNION_ID || "yangmao"),
    pid: String(env.JD_PID || ""),
    couponUrl: String(opts.couponUrl || ""),
    chainType: Number(opts.chainType || 1)
  };

  var methods = ["jd.union.open.promotion.bysubunionid.get", "jd.union.open.promotion.common.get"];
  var lastErr = "";
  for (var i = 0; i < methods.length; i++) {
    var r = await jdInvoke(env, methods[i], { promotionCodeReq: req }, opts.timeout || 8000);
    if (r.ok) {
      var d = r.data || {};
      var url = d.shortURL || d.clickURL || d.shortUrl || d.clickUrl || "";
      if (url) {
        return {
          url: url,
          shortUrl: d.shortURL || d.shortUrl || "",
          clickUrl: d.clickURL || d.clickUrl || "",
          channel: "jd-api",
          method: methods[i]
        };
      }
      lastErr = "返回里没有推广链接";
    } else {
      lastErr = r.code + " " + r.desc;
      /* 权限没申请 / appKey 无效这类硬错误，换方法名也没用，直接停 */
      if (/Invalid app_key|21\b/.test(lastErr)) break;
    }
  }
  return { error: lastErr };
}

/* 探针：给 /api/health 用，一眼看出京东官方通道通不通 */
export async function jdProbe(env) {
  if (!jdReady(env)) return { ok: false, reason: "未配置 JD_APP_KEY / JD_APP_SECRET / JD_SITE_ID" };
  var r = await jdUniversal(env, "https://item.jd.com/100012043978.html", { timeout: 6000 });
  if (r && r.url) return { ok: true, url: r.url, channel: r.channel };
  return { ok: false, reason: (r && r.error) || "未知错误" };
}
