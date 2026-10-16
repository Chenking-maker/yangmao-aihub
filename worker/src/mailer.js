/* 羊毛AIHUB · 邮件告警（QQ SMTP 直连版）
 *
 * Cloudflare Workers 不支持第三方 SMTP 库，但支持 TCP socket（cloudflare:sockets），
 * 这里直接实现一段最小 SMTP 客户端，用 QQ 邮箱的 SMTPS（465 端口）发告警邮件。
 *
 * 需要配置的密钥：
 *   SMTP_USER      发件邮箱，例如 370542303@qq.com
 *   SMTP_PASS      QQ 邮箱「授权码」（设置→账号→开启 SMTP→生成授权码；不是登录密码！）
 *   ALERT_MAIL_TO  收件邮箱，例如 370542303@qq.com（可以和发件相同）
 *
 * 全部走环境变量，未配置时 sendMail() 安静返回 { sent:false }，不影响主流程。
 */
function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

/** SMTP 会话封装：按行读响应，直到「完成行」（3位数字+空格）出现 */
async function smtpSend(env, { subject, text }) {
  // 动态导入：Node 本地测试没有 cloudflare:sockets，动态导入失败时安静降级
  let connect = null;
  try { ({ connect } = await import("cloudflare:sockets")); } catch (e) { /* ignore */ }
  if (!connect) throw new Error("当前运行环境不支持 cloudflare:sockets（本地 Node 无法发信，部署到 Workers 后正常）");

  const host = env.SMTP_HOST || "smtp.qq.com";
  const port = Number(env.SMTP_PORT || 465);
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASS;
  const to = env.ALERT_MAIL_TO || user;
  const from = env.SMTP_FROM || user;

  const socket = connect({ hostname: host, port: port }, { secureTransport: "on", allowHalfOpen: false });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buf = "";

  async function readReply() {
    for (let i = 0; i < 300; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      if (buf.endsWith("\r\n")) {
        const lines = buf.split("\r\n").filter(Boolean);
        const last = lines[lines.length - 1];
        if (/^\d{3} /.test(last)) return lines;
      }
    }
    return buf.split("\r\n").filter(Boolean);
  }

  async function cmd(line, code) {
    await writer.write(enc.encode(line + "\r\n"));
    const lines = await readReply();
    const ok = lines.some((l) => l.startsWith(code + " "));
    return { ok, lines };
  }

  const transcript = [];
  try {
    let r = await readReply();                                  // 220 服务器就绪
    transcript.push(...r);
    if (!r.some((l) => l.startsWith("220"))) throw new Error("SMTP 未就绪: " + r.join(" | "));

    r = await cmd("EHLO woolaihub", "250"); transcript.push(...r);
    if (!r.ok) throw new Error("EHLO 失败");

    r = await cmd("AUTH LOGIN", "334"); transcript.push(...r);
    if (!r.ok) throw new Error("服务器不支持 AUTH LOGIN");

    r = await cmd(b64(user), "334"); transcript.push(...r);
    if (!r.ok) throw new Error("用户名被拒");

    r = await cmd(b64(pass), "235"); transcript.push(...r);
    if (!r.ok) throw new Error("授权码验证失败（检查 SMTP_PASS 是否为「授权码」而非登录密码）");

    r = await cmd("MAIL FROM:<" + from + ">", "250"); transcript.push(...r);
    if (!r.ok) throw new Error("MAIL FROM 被拒");

    r = await cmd("RCPT TO:<" + to + ">", "250"); transcript.push(...r);
    if (!r.ok) throw new Error("收件人被拒: " + to);

    r = await cmd("DATA", "354"); transcript.push(...r);
    if (!r.ok) throw new Error("DATA 被拒");

    const body = b64(text).replace(/(.{76})/g, "$1\r\n");
    const payload =
      "From: =?UTF-8?B?" + b64("羊毛AIHUB 监控") + "?= <" + from + ">\r\n" +
      "To: <" + to + ">\r\n" +
      "Subject: =?UTF-8?B?" + b64(subject) + "?=\r\n" +
      "Date: " + new Date().toUTCString() + "\r\n" +
      "MIME-Version: 1.0\r\n" +
      "Content-Type: text/plain; charset=UTF-8\r\n" +
      "Content-Transfer-Encoding: base64\r\n" +
      "\r\n" +
      body + "\r\n.";
    r = await cmd(payload, "250"); transcript.push(...r);
    if (!r.ok) throw new Error("邮件正文被拒");

    await cmd("QUIT", "221");
    return { sent: true };
  } finally {
    try { writer.releaseLock(); } catch (e) { /* ignore */ }
    try { reader.releaseLock(); } catch (e) { /* ignore */ }
    try { socket.close(); } catch (e) { /* ignore */ }
  }
}

/** 发告警邮件；未配置或失败都不抛异常（告警本身不能把主流程搞挂） */
export async function sendAlert(env, subject, text) {
  if (!env.SMTP_USER || !env.SMTP_PASS) return { sent: false, reason: "SMTP 未配置（SMTP_USER / SMTP_PASS）" };
  try {
    await smtpSend(env, { subject: subject, text: text });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: String(e.message || e) };
  }
}
