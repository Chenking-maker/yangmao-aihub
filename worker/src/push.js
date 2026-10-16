/**
 * 羊毛AIHUB · 微信推送通道（省钱日报 / 线报播报）
 * 免服务器、免公众号，两条通道任配其一即可：
 *   ① PushPlus  —— 个人微信就能收（推荐，扫码免费拿 token）
 *        env.PUSH_TOKEN      = pushplus 的 token
 *   ② 企业微信群机器人 webhook
 *        env.WECOM_WEBHOOK   = https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
 * 两个都没配时静默跳过，绝不阻塞主流程。
 */

function htmlWrap(title, sections) {
  // 微信内直接看，用内联样式；PushPlus / 企业微信都吃 HTML
  var body = sections.map(function (s) {
    return '<div style="margin:10px 0;padding:12px 14px;background:#fff7f7;border:1px solid #f2d5d3;border-radius:10px;font:14px/1.7 -apple-system,\'PingFang SC\',sans-serif;color:#2b2b2b">' +
      (s.t ? '<div style="font-weight:700;color:#d93832;margin-bottom:4px">' + s.t + '</div>' : '') +
      s.b + '</div>';
  }).join("");
  return '<div style="max-width:560px;margin:0 auto;padding:6px">' +
    '<div style="font:700 17px/1.5 -apple-system,\'PingFang SC\',sans-serif;color:#111">' + title + '</div>' +
    body +
    '<div style="margin-top:10px;font:12px/1.6 sans-serif;color:#999">羊毛AIHUB · 找优惠？AI 帮你找！</div></div>';
}

export async function sendPush(env, title, html) {
  var results = [];

  if (env.PUSH_TOKEN) {
    try {
      var r = await fetch("https://www.pushplus.plus/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: env.PUSH_TOKEN,
          title: title,
          content: html,
          template: "html"
        })
      });
      var j = {};
      try { j = await r.json(); } catch (e) { j = {}; }
      results.push({ channel: "pushplus", ok: Number(j.code) === 200, msg: j.msg || "" });
    } catch (e) {
      results.push({ channel: "pushplus", ok: false, msg: String(e.message || e) });
    }
  }

  if (env.WECOM_WEBHOOK) {
    try {
      var r2 = await fetch(env.WECOM_WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ msgtype: "markdown", markdown: { content: title + "\n" + html.replace(/<[^>]+>/g, "").replace(/\n{2,}/g, "\n") } })
      });
      var j2 = {};
      try { j2 = await r2.json(); } catch (e) { j2 = {}; }
      results.push({ channel: "wecom", ok: Number(j2.errcode) === 0, msg: j2.errmsg || "" });
    } catch (e) {
      results.push({ channel: "wecom", ok: false, msg: String(e.message || e) });
    }
  }

  if (!results.length) return { sent: false, reason: "未配置 PUSH_TOKEN / WECOM_WEBHOOK" };
  return { sent: results.some(function (x) { return x.ok; }), results: results };
}

export { htmlWrap };
