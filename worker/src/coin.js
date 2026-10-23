/**
 * 淘金币互助广场 · 存储层（Cloudflare D1）
 * ------------------------------------------------------------
 * 设计目标：让「我帮你点、你帮我点」这件事在网页上闭环，且不用登录。
 *
 * 规则（前端文案与这里必须一致）：
 *   ① 每人每天最多发布 10 条、助力 10 次；每条最多被助力 10 次
 *   ② 发布额度 = 已助力次数（严格 1:1，先帮别人 1 次才有 1 条发布额度）
 *      广场里一条别人的都没有时（冷启动）放行，避免第一位用户被卡死
 *   ③ 同一人同一天不能重复发同一口令；不能给自己助力
 *   ④ 只接受淘宝系链接（防钓鱼），口令按分享文案解析
 *
 * 表结构：
 *   coin_items  一条互助/组队（id 主键，cts = 毫秒时间戳）
 *   coin_acts   谁帮了哪条（(item_id,uid,act) 联合主键 → 天然去重）
 * 助力数用 coin_items.hits 冗余计数（读列表只查一张表，快）。
 */

const PUB_MAX = 10;
const HELP_MAX = 10;
const HITS_MAX = 10;
const IP_PUB_MAX = 40;    // 同一出口 IP 每天最多发 40 条（家用宽带常多人共用，放宽）
const IP_ACT_MAX = 150;
const KEEP_MS = 3 * 86400000;   // 列表只显示最近 3 天

/* ---------- 北京时间工具（Worker 运行在 UTC） ---------- */
function bjStart(ts) {
  const d = new Date(ts + 8 * 3600000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 8 * 3600000;
}
function bjDay(ts) {
  return new Date(ts + 8 * 3600000).toISOString().slice(0, 10);
}

/* ---------- 只认可淘宝/天猫域名，避免变成钓鱼链接广场 ---------- */
const ALLOW_HOST = /(^|\.)(tb\.cn|taobao\.com|taobao\.org|tmall\.com|tmall\.hk)$/i;

const WORD_RE = /[A-Za-z0-9]{0,4}[￥¥€£$₤₩₽][A-Za-z0-9]{6,24}[￥¥€£$₤₩₽]/;
const LINK_RE = /https?:\/\/[^\s，,。；;：:"'<>（）()【】\[\]]+/i;

export function parseCoinText(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim().slice(0, 600);
  if (!raw) return { error: "把淘口令或链接粘贴进来" };

  let link = "";
  let rest = raw;
  const lm = raw.match(LINK_RE);
  if (lm) {
    const u = lm[0].replace(/[.,。、]+$/, "");
    let host = "";
    try { host = new URL(u).hostname; } catch (e) { host = ""; }
    if (!host) return { error: "链接格式不对，请重新复制" };
    if (!ALLOW_HOST.test(host)) {
      return { error: "只支持淘宝 / 天猫的链接（m.tb.cn、item.taobao.com 等），其它链接不能发布" };
    }
    link = u;
    rest = raw.replace(lm[0], " ");
  }

  const wm = rest.match(WORD_RE) || raw.match(WORD_RE);
  const word = wm ? wm[0] : "";
  let note = (wm ? rest.replace(wm[0], " ") : rest).replace(/\s+/g, " ").trim();
  if (!word && !link) {
    return { error: "没识别到淘口令或链接。请在淘宝里点「分享 → 复制链接」再整段粘贴过来" };
  }
  if (!word) note = note.slice(0, 60);
  return { word, link, note: note.slice(0, 60) };
}

/* ---------- 建表（每个 isolate 只跑一次） ---------- */
let schemaDone = null;
async function ensureSchema(env) {
  if (!env || !env.DB) return false;
  if (schemaDone) return schemaDone;
  schemaDone = (async () => {
    try {
      await env.DB.batch([
        env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS coin_items (" +
          "id TEXT PRIMARY KEY, uid TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'help'," +
          "word TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT ''," +
          "target INTEGER NOT NULL DEFAULT 0, hits INTEGER NOT NULL DEFAULT 0," +
          "ip TEXT NOT NULL DEFAULT '', cts INTEGER NOT NULL)"
        ),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_coin_cts ON coin_items(cts)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_coin_uid ON coin_items(uid, cts)"),
        env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS coin_acts (" +
          "item_id TEXT NOT NULL, uid TEXT NOT NULL, act TEXT NOT NULL DEFAULT 'help'," +
          "ip TEXT NOT NULL DEFAULT '', cts INTEGER NOT NULL, PRIMARY KEY (item_id, uid, act))"
        ),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_coin_act ON coin_acts(uid, act, cts)")
      ]);
      return true;
    } catch (e) {
      schemaDone = null;   // 失败下回重试
      return false;
    }
  })();
  return schemaDone;
}

function cleanUid(uid) {
  const s = String(uid || "");
  return /^[A-Za-z0-9_-]{8,48}$/.test(s) ? s : "";
}
function newId() {
  const t = Date.now().toString(36);
  let r = "";
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  for (let i = 0; i < 5; i++) r += abc[Math.floor(Math.random() * abc.length)];
  return "c" + t + r;
}

function shape(r, uid, actedSet) {
  return {
    id: r.id,
    mine: r.uid === uid,
    owner: r.uid === "owner",
    kind: r.kind,
    word: r.word || "",
    link: r.link || "",
    note: r.note || "",
    target: r.target || 0,
    hits: r.hits || 0,
    full: (r.hits || 0) >= HITS_MAX,
    acted: actedSet.has(r.id + "|" + (r.kind === "team" ? "join" : "help")),
    cts: r.cts
  };
}

/* ============================= 读广场 ============================= */
export async function coinBoard(env, opts) {
  const uid = cleanUid(opts.uid);
  if (!uid) return { error: "缺少用户标识，请刷新页面重试" };
  if (!(await ensureSchema(env))) return { error: "互助数据服务未就绪，稍后再试", soft: true };

  const tab = opts.tab === "team" ? "team" : "help";
  const now = Date.now();
  const start = bjStart(now);
  const from = now - KEEP_MS;

  const stmts = [
    env.DB.prepare(
      "SELECT id,uid,kind,word,link,note,target,hits,cts FROM coin_items " +
      "WHERE kind=? AND cts>=? " +
      "ORDER BY CASE WHEN uid='owner' THEN 0 ELSE 1 END, hits ASC, cts DESC LIMIT 80"
    ).bind(tab, from),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items WHERE uid=? AND kind='help' AND cts>=?").bind(uid, start),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_acts WHERE uid=? AND act='help' AND cts>=?").bind(uid, start),
    env.DB.prepare("SELECT item_id, act FROM coin_acts WHERE uid=? AND cts>=?").bind(uid, start),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items WHERE kind='help' AND cts>=?").bind(start),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items WHERE kind='team' AND cts>=?").bind(start)
  ];
  const rs = await env.DB.batch(stmts);
  const rows = (rs[0] && rs[0].results) || [];
  const pub = (rs[1] && rs[1].results && rs[1].results[0] && rs[1].results[0].c) || 0;
  const helped = (rs[2] && rs[2].results && rs[2].results[0] && rs[2].results[0].c) || 0;
  const actedSet = new Set(((rs[3] && rs[3].results) || []).map(function (x) { return x.item_id + "|" + x.act; }));
  const totalHelp = (rs[4] && rs[4].results && rs[4].results[0] && rs[4].results[0].c) || 0;
  const totalTeam = (rs[5] && rs[5].results && rs[5].results[0] && rs[5].results[0].c) || 0;

  const need = pub + 1;
  const others = Math.max(0, totalHelp - pub);
  const gated = others > 0 && helped < need;

  return {
    ok: true,
    tab,
    day: bjDay(now),
    items: rows.map(function (r) { return shape(r, uid, actedSet); }),
    quota: {
      pub: pub, pubMax: PUB_MAX,
      helped: helped, helpMax: HELP_MAX,
      need: need,
      miss: Math.max(0, need - helped),
      gated: gated,
      canPub: pub < PUB_MAX && !gated,
      hitsMax: HITS_MAX
    },
    stats: { help: totalHelp, team: totalTeam }
  };
}

/* ============================= 发布 ============================= */
export async function coinPublish(env, opts) {
  const uid = cleanUid(opts.uid);
  if (!uid) return { error: "缺少用户标识，请刷新页面重试" };
  if (!(await ensureSchema(env))) return { error: "互助数据服务未就绪，稍后再试", soft: true };

  const kind = opts.kind === "team" ? "team" : "help";
  const parsed = parseCoinText(opts.text);
  if (parsed.error) return { error: parsed.error };

  let note = parsed.note;
  let target = 0;
  if (kind === "team") {
    const name = String(opts.name || "").replace(/\s+/g, " ").trim().slice(0, 24);
    if (!name) return { error: "给队伍起个名字吧（比如：双11 冲 1188 加抵金 3 人队）" };
    target = Math.max(2, Math.min(20, Number(opts.target) || 3));
    note = name;
  }

  const now = Date.now();
  const start = bjStart(now);
  const ip = String(opts.ip || "").slice(0, 64);

  const chk = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items WHERE uid=? AND kind='help' AND cts>=?").bind(uid, start),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_acts WHERE uid=? AND act='help' AND cts>=?").bind(uid, start),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items WHERE kind='help' AND cts>=?").bind(start),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items WHERE uid=? AND cts>=? AND (word=? OR (link<>'' AND link=?))")
      .bind(uid, start, parsed.word || "-", parsed.link || "-"),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items WHERE ip=? AND cts>=?").bind(ip, start)
  ]);
  const pub = chk[0].results[0].c || 0;
  const helped = chk[1].results[0].c || 0;
  const totalHelp = chk[2].results[0].c || 0;
  const dup = chk[3].results[0].c || 0;
  const ipPub = chk[4].results[0].c || 0;

  if (ipPub >= IP_PUB_MAX) return { error: "这个网络今天发布得太多了，明天再来吧" };
  if (dup > 0) return { error: "这条你今天已经发布过了，去广场里点它就能看到" };

  if (kind === "help") {
    if (pub >= PUB_MAX) return { error: "今天的 10 次发布额度已经用完了，明天 0 点刷新" };
    const others = Math.max(0, totalHelp - pub);
    if (others > 0 && helped < pub + 1) {
      return {
        error: "发布额度已用完：先帮 " + (pub + 1 - helped) + " 个人助力，就能再发一条",
        needHelp: pub + 1 - helped,
        quota: { pub: pub, helped: helped }
      };
    }
  }

  const id = newId();
  await env.DB.prepare(
    "INSERT INTO coin_items (id,uid,kind,word,link,note,target,hits,ip,cts) VALUES (?,?,?,?,?,?,?,0,?,?)"
  ).bind(id, uid, kind, parsed.word || "", parsed.link || "", note || "", target, ip, now).run();

  return {
    ok: true, id: id, kind: kind,
    word: parsed.word, link: parsed.link, note: note,
    quota: { pub: kind === "help" ? pub + 1 : pub, pubMax: PUB_MAX, helped: helped, helpMax: HELP_MAX }
  };
}

/* ============================= 助力 / 入队 ============================= */
export async function coinAct(env, opts) {
  const uid = cleanUid(opts.uid);
  if (!uid) return { error: "缺少用户标识，请刷新页面重试" };
  if (!(await ensureSchema(env))) return { error: "互助数据服务未就绪，稍后再试", soft: true };
  const id = String(opts.id || "").slice(0, 40);
  if (!id) return { error: "缺少条目 id" };

  const now = Date.now();
  const start = bjStart(now);
  const ip = String(opts.ip || "").slice(0, 64);

  const item = await env.DB.prepare("SELECT id,uid,kind,hits FROM coin_items WHERE id=?").bind(id).first();
  if (!item) return { error: "这条已经过期或被删除了，刷新看看新的" };
  if (item.uid === uid) return { error: "这是你自己发的，去帮帮别人吧" };

  const act = item.kind === "team" ? "join" : "help";
  if (act === "help" && item.hits >= HITS_MAX) {
    return { error: "这条今天已经满 " + HITS_MAX + " 次助力了，换一条帮帮" };
  }

  const chk = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_acts WHERE uid=? AND act='help' AND cts>=?").bind(uid, start),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_acts WHERE ip=? AND cts>=?").bind(ip, start)
  ]);
  const helped = chk[0].results[0].c || 0;
  const ipAct = chk[1].results[0].c || 0;
  if (ipAct >= IP_ACT_MAX) return { error: "这个网络今天操作太频繁了，明天再来" };
  if (act === "help" && helped >= HELP_MAX) return { error: "今天 10 次助力额度用完了，明天 0 点刷新" };

  const ins = await env.DB.prepare(
    "INSERT OR IGNORE INTO coin_acts (item_id,uid,act,ip,cts) VALUES (?,?,?,?,?)"
  ).bind(id, uid, act, ip, now).run();
  const changed = (ins && ins.meta && ins.meta.changes) || 0;
  if (!changed) {
    return { ok: true, repeat: true, action: act, hits: item.hits, quota: { helped: helped, helpMax: HELP_MAX } };
  }
  await env.DB.prepare("UPDATE coin_items SET hits=hits+1 WHERE id=?").bind(id).run();

  return {
    ok: true, action: act, hits: item.hits + 1,
    quota: { helped: act === "help" ? helped + 1 : helped, helpMax: HELP_MAX }
  };
}

/* ============================= 删除自己的 ============================= */
export async function coinDelete(env, opts) {
  const uid = cleanUid(opts.uid);
  if (!uid) return { error: "缺少用户标识" };
  if (!(await ensureSchema(env))) return { error: "互助数据服务未就绪", soft: true };
  const id = String(opts.id || "").slice(0, 40);
  const r = await env.DB.prepare("DELETE FROM coin_items WHERE id=? AND uid=?").bind(id, uid).run();
  if (!((r && r.meta && r.meta.changes) || 0)) return { error: "没找到这条（可能不是你的）" };
  await env.DB.prepare("DELETE FROM coin_acts WHERE item_id=?").bind(id).run();
  return { ok: true };
}

/* ============================= 站长口令每天补种 ============================= */
/* 目的：站长的口令始终挂在广场第一位，别人打开页面就有点可帮（冷启动不空场）。
 * 由 cron 每天调用一次；当天已有 owner 条目就跳过。 */
export async function coinSeedOwner(env) {
  if (!(await ensureSchema(env))) return { skipped: "D1 未就绪" };
  const text = String(env.COIN_OWNER_TEXT || "").trim();
  if (!text) return { skipped: "未配置 COIN_OWNER_TEXT" };

  const now = Date.now();
  const start = bjStart(now);
  const has = await env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items WHERE uid='owner' AND cts>=?").bind(start).first();
  if (has && has.c > 0) return { skipped: "今天已经种过了" };

  const parsed = parseCoinText(text);
  if (parsed.error) return { error: parsed.error };
  const id = newId();
  await env.DB.prepare(
    "INSERT INTO coin_items (id,uid,kind,word,link,note,target,hits,ip,cts) VALUES (?,?,?,?,?,?,?,0,?,?)"
  ).bind(id, "owner", "help", parsed.word || "", parsed.link || "", parsed.note || "", 0, "seed", now).run();
  return { ok: true, id: id, word: parsed.word, link: parsed.link };
}

/* 探针：给 /api/health?deep=1 用 */
export async function coinProbe(env) {
  if (!env || !env.DB) return "未绑定 D1（互助广场不可用）";
  if (!(await ensureSchema(env))) return "D1 建表失败";
  try {
    const r = await env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items").first();
    return { ok: true, items: (r && r.c) || 0 };
  } catch (e) {
    return "D1 查询失败：" + String((e && e.message) || e).slice(0, 80);
  }
}
