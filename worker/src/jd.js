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
    if (!json) return { ok: false, code: "bad-json", desc: String(raw).slice(0, 200) };

    /* 京东网关的返回有三个坑，全踩过：
     *   ① 结果字段拼写是 `xxx_responce`（少一个 s），不是标准的 `_response`；
     *   ② 网关层 code=0 才算调用成功，真正的业务码被 JSON 字符串再包一层塞在 getResult 里；
     *   ③ 另一部分接口又把结果放在 data 里。
     *   （踩坑记录：只看 `_response` 会把明明有业务错误码的返回误判成 no-node，
     *     于是一个真实错误被淹没成「未知错误」。） */
    var base = method.replace(/\./g, "_");
    var node = json[base + "_response"] || json[base + "_responce"] ||
      json.error_response || json.error_responce || null;
    if (!node) {
      for (var kk in json) {
        if (/_resp(on)?ce$/.test(String(kk))) { node = json[kk]; break; }
      }
    }
    if (!node) return { ok: false, code: "no-node", desc: raw.slice(0, 200) };

    var payload = null;
    if (node.getResult !== undefined) payload = node.getResult;
    else if (node.data !== undefined) payload = node.data;
    if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch (e) { payload = null; } }

    /* 网关层失败（app_key 无效 / 签名错 / 方法名不存在）：没有业务体，看 node.code */
    if (payload === null) {
      if (node.code !== undefined && String(node.code) !== "0") {
        return { ok: false, code: String(node.code), desc: String(node.zh_desc || node.en_desc || node.msg || "") };
      }
      return { ok: false, code: "no-payload", desc: raw.slice(0, 200) };
    }
    /* 业务层失败：业务码在 payload.code 里，1000+ 那串是京东联盟自己的错误码 */
    if (payload.code !== undefined && String(payload.code) !== "200") {
      return { ok: false, code: String(payload.code), desc: String(payload.message || payload.msg || "") };
    }
    return { ok: true, data: payload.data || payload, raw: raw };
  } catch (e) {
    if (timer) clearTimeout(timer);
    return { ok: false, code: "network", desc: String((e && e.message) || e) };
  }
}

/* ---------- 错误码翻译 ----------
 * 京东联盟的错误码不查文档根本看不懂，这里翻成人话 + 下一步该做什么。
 * 常见三种：
 *   403      该应用没开通「社交媒体转链」接口（bysubunionid.get）→ 联系联盟客服申请
 *   2001701  传了「导购媒体ID」→ 这个接口只认网站ID/APP ID（接口明确禁止导购媒体入参）
 *   1002024  siteId 为空
 */
var JD_HINT = {
  "403": "该应用未开通「社交媒体转链」接口权限（jd.union.open.promotion.bysubunionid.get）。去 union.jd.com 联系联盟客服或发邮件 cps@jd.com 申请，开通后本通道自动生效，不用改代码",
  "2001701": "转链接口禁止使用「导购媒体ID」，只认「网站ID / APP ID」（京东联盟 → 推广管理 → 网站管理 / APP管理 里查看），或改申请社交媒体转链接口权限",
  "1002024": "siteId 不能为空：请在 Cloudflare 后台补上 JD_SITE_ID（网站ID 或 APP ID）",
  "21": "appKey 无效或签名不通过（检查 JD_APP_KEY / JD_APP_SECRET 是否成对）",
  "2001602": "账号未签署联盟协议或没有母账号权限",
  "2001403": "无调用权限，请联系联盟运营申请"
};
function jdHint(code, desc) {
  var k = String(code === undefined || code === null ? "" : code).trim();
  var hit = JD_HINT[k] || JD_HINT[k.replace(/^0+(?=\d)/, "")];
  if (hit) return hit;
  return desc || ("京东返回 " + k);
}
/* 「软失败」= 配置或权限还没到位（不是服务挂了），不该触发告警轰炸，只提示一次。 */
function jdSoft(code, desc) {
  return /403|2001701|1002024|^21$|未配置|invalid app_key/i.test(String(code || "") + " " + String(desc || ""));
}

/* ---------- 万能转链 ----------
 * 京东联盟官方「万能转链」：传什么链接就转什么链接 ——
 * 商品详情页、活动会场、u.jd.com 短链都吃。佣金 100% 归自己。
 * 两个候选接口，按权限情况自动挑：
 *   ① jd.union.open.promotion.bysubunionid.get（社交媒体转链，用 subUnionId 标识渠道；需申请权限）
 *   ② jd.union.open.promotion.common.get（通用转链，需网站ID/APP ID）
 * 返回 { url, shortUrl, channel, method } 或 { error, soft }。
 */
export async function jdUniversal(env, materialUrl, opts) {
  opts = opts || {};
  if (!jdReady(env) || !materialUrl) return null;

  function reqOf(chainType) {
    return {
      materialId: String(materialUrl),
      siteId: String(env.JD_SITE_ID || ""),
      positionId: Number(opts.positionId || 0),
      subUnionId: String(env.JD_SUB_UNION_ID || "yangmao"),
      pid: String(env.JD_PID || ""),
      couponUrl: String(opts.couponUrl || ""),
      chainType: Number(chainType || 1)
    };
  }

  var methods = ["jd.union.open.promotion.bysubunionid.get", "jd.union.open.promotion.common.get"];
  var lastErr = "", lastCode = "", soft = false;

  for (var i = 0; i < methods.length; i++) {
    /* chainType：2=短链（微信里更好点开），失败降级 1=长链（长期有效） */
    for (var c = 0; c < 2; c++) {
      var r = await jdInvoke(env, methods[i], { promotionCodeReq: reqOf(c === 0 ? 2 : 1) }, opts.timeout || 8000);
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
        lastErr = "返回里没有推广链接：" + String(r.raw || "").slice(0, 160);
        lastCode = "no-url";
        break;   // 参数被接受了但没给链接，换方法名也没用，直接换下一个方法
      }
      lastErr = jdHint(r.code, r.desc);
      lastCode = r.code;
      soft = soft || jdSoft(r.code, r.desc);
      /* 权限没开通 / appKey 无效 / siteId 不合法：换 chainType 重试也是同样结果 */
      if (/403|2001701|1002024|^21$|Invalid app_key|no-node|bad-json/i.test(String(r.code))) break;
    }
  }
  return { error: lastErr, code: lastCode, soft: soft };
}

/* 探针：给 /api/health 用，一眼看出京东官方通道通不通、还差哪个值 */
export async function jdProbe(env) {
  env = env || {};
  var miss = [];
  if (!env.JD_APP_KEY) miss.push("JD_APP_KEY");
  if (!env.JD_APP_SECRET) miss.push("JD_APP_SECRET");
  if (!env.JD_SITE_ID && !env.JD_PID) miss.push("JD_SITE_ID");
  if (miss.length) return { ok: false, soft: true, reason: "未配置 " + miss.join(" / ") };
  var r = await jdUniversal(env, "https://item.jd.com/100012043978.html", { timeout: 6000 });
  if (r && r.url) return { ok: true, url: r.url, channel: r.channel, method: r.method };
  /* soft=true 表示「权限/参数没配好」而不是「服务挂了」——探针只提示，不告警 */
  return { ok: false, soft: !!(r && r.soft), code: (r && r.code) || "", reason: (r && r.error) || "未知错误" };
}
