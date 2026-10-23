/**
 * 淘金币互助广场 · 存储层（Cloudflare D1）
 * ------------------------------------------------------------
 * 设计目标：让「我帮你点、你帮我点」这件事在网页上闭环，且不用登录。
 *
 * 规则（v2.20，前端文案与这里必须一致）：
 *   ① 每个 IP 每天最多发布 1 条口令（uid 维度同样限 1 条，清缓存换号也没用）；
 *      组队信息每个 IP / uid 每天最多 5 条
 *   ② 每人每天最多助力 10 次；每条最多被 10 人助力
 *   ③ 发布资格（助力门槛，按天动态）：
 *      - 站长推荐还有名额（最新 owner 条目 hits<10）→ 助力 1 次即可发布
 *      - 站长名额已满（或广场没有站长条目）→ 必须助力 3 条才能发布
 *      - 防死锁：广场里「能帮的条目」不足时按实际数量算（全帮完就能发布）；
 *        一条能帮的都没有时直接放行（冷启动 / 全被助力满）
 *   ④ 助力 / 入队必须留下淘宝昵称（2-20 字，页面打码展示，方便对方核对是谁帮了忙）
 *   ⑤ 同一人同一天不能重复发同一口令；不能给自己助力
 *   ⑥ 只接受淘宝系链接（防钓鱼），口令按分享文案解析
 *   ⑦ 组队人数 2~5
 *
 * 表结构：
 *   coin_items  一条互助/组队（id 主键，cts = 毫秒时间戳）
 *   coin_acts   谁帮了哪条（(item_id,uid,act) 联合主键 → 天然去重；
 *               tao 列 = 助力者留下的淘宝昵称，v2.20 新增）
 * 助力数用 coin_items.hits 冗余计数（读列表只查一张表，快）。
 */

const PUB_MAX = 1;          // 每个 uid 每天最多发布 1 条口令
const PUB_TEAM_MAX = 5;     // 每个 uid 每天最多发布 5 支队伍
const HELP_MAX = 10;        // 每人每天最多助力 10 次
const HITS_MAX = 10;        // 每条最多被 10 人助力
const NEED_OWNER = 1;       // 站长推荐还有名额时：助力 1 次即可发布
const NEED_FULL = 3;        // 站长名额满了：必须助力 3 条才能发布
const IP_PUB_MAX = 1;       // 同一出口 IP 每天最多发布 1 条口令（用户要求）
const IP_PUB_TEAM_MAX = 5;  // 同一出口 IP 每天最多发布 5 支队伍
const IP_ACT_MAX = 100;     // 同一出口 IP 每天最多助力 100 次（防刷兜底）
const TEAM_MIN = 2;
const TEAM_MAX = 5;
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

/* ---------- 淘宝昵称（助力留痕） ---------- */
function sanitizeTao(t) {
  const s = String(t || "").replace(/[\s\u0000-\u001f<>"'&]/g, "").trim().slice(0, 20);
  if (s.length < 2) return "";
  if (!/^[一-龥A-Za-z0-9_.·*-]+$/.test(s)) return "";
  return s;
}
/* 打码：留首尾，中间藏起来 —— 既能看出「是谁」，又不暴露全名 */
function maskTao(t) {
  const s = String(t || "").trim();
  if (!s) return "";
  if (s.length <= 2) return s + "*";
  return s[0] + "**" + s[s.length - 1];
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
      /* v2.20 新增「助力留痕」列：老表补列。已有时会抛 duplicate column，忽略即可 */
      try {
        await env.DB.prepare("ALTER TABLE coin_acts ADD COLUMN tao TEXT NOT NULL DEFAULT ''").run();
      } catch (e) { /* 列已存在 */ }
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

/* 发布资格门槛：站长推荐有没有名额决定助力 1 次还是 3 次；
 * helpable = 广场里「别人的、没满」的条目数 —— 能帮的不足 3 条时按实际数量算
 * （否则新人会被卡死：帮不够 3 条就永远不能发，广场也永远长不大）。
 * 注意：不排除「我助力过的」—— 排除它会让门槛随助力动态缩水（帮 1 条 → 只剩 1 条可帮 → 门槛变 1）。
 * 一条能帮的都没有 → need=0 直接放行（冷启动 / 全被助力满）。 */
async function gateOf(env, start, from, uid) {
  const ownerR = await env.DB.prepare(
    "SELECT hits FROM coin_items WHERE uid='owner' AND kind='help' AND cts>=? ORDER BY cts DESC LIMIT 1"
  ).bind(start).first();
  const ownerOpen = !!ownerR && (ownerR.hits || 0) < HITS_MAX;
  const base = ownerOpen ? NEED_OWNER : NEED_FULL;
  const hp = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM coin_items i WHERE i.kind='help' AND i.cts>=? AND i.uid<>? AND i.hits<?"
  ).bind(from, uid, HITS_MAX).first();
  const helpable = (hp && hp.c) || 0;
  const need = helpable > 0 ? Math.min(base, helpable) : 0;
  return { ownerOpen: ownerOpen, need: need, helpable: helpable };
}

function shape(r, uid, actedSet, helpersMap) {
  const helpers = (helpersMap.get(r.id) || []).slice(0, HITS_MAX).map(maskTao).filter(Boolean);
  return {
    id: r.id,
    mine: r.uid === uid,
    owner: r.uid === "owner",
    kind: r.kind,
    word: r.word || "",
    link: r.link || "",
    note: r.note || "",
    target: r.kind === "team" ? (r.target || 0) : HITS_MAX,
    hits: r.hits || 0,
    full: (r.hits || 0) >= HITS_MAX,
    acted: actedSet.has(r.id + "|" + (r.kind === "team" ? "join" : "help")),
    helpers: helpers,
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
    /* owner 条目永远置顶（最新的一天一条，满不满都看得到）；其他人按「还没被助力过」优先 */
    env.DB.prepare(
      "SELECT id,uid,kind,word,link,note,target,hits,cts FROM coin_items " +
      "WHERE kind=? AND cts>=? " +
      "ORDER BY CASE WHEN uid='owner' THEN 0 ELSE 1 END, " +
      "CASE WHEN uid='owner' THEN -cts ELSE hits END, cts DESC LIMIT 80"
    ).bind(tab, from),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items WHERE uid=? AND kind='help' AND cts>=?").bind(uid, start),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items WHERE uid=? AND kind='team' AND cts>=?").bind(uid, start),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_acts WHERE uid=? AND act='help' AND cts>=?").bind(uid, start),
    env.DB.prepare("SELECT item_id, act FROM coin_acts WHERE uid=? AND cts>=?").bind(uid, start),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items WHERE kind='help' AND cts>=?").bind(start),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items WHERE kind='team' AND cts>=?").bind(start)
  ];
  const rs = await env.DB.batch(stmts);
  const rows = (rs[0] && rs[0].results) || [];
  const pub = (rs[1] && rs[1].results && rs[1].results[0] && rs[1].results[0].c) || 0;
  const pubTeam = (rs[2] && rs[2].results && rs[2].results[0] && rs[2].results[0].c) || 0;
  const helped = (rs[3] && rs[3].results && rs[3].results[0] && rs[3].results[0].c) || 0;
  const actedSet = new Set(((rs[4] && rs[4].results) || []).map(function (x) { return x.item_id + "|" + x.act; }));
  const totalHelp = (rs[5] && rs[5].results && rs[5].results[0] && rs[5].results[0].c) || 0;
  const totalTeam = (rs[6] && rs[6].results && rs[6].results[0] && rs[6].results[0].c) || 0;

  /* 助力者留痕（打码）：一次查回来按条目分组，避免 N+1 查询 */
  const helpersMap = new Map();
  if (rows.length) {
    const hr = await env.DB.prepare(
      "SELECT item_id, tao FROM coin_acts WHERE cts>=? ORDER BY cts DESC LIMIT 1200"
    ).bind(from).all();
    const list = (hr && hr.results) || [];
    for (let i = 0; i < list.length; i++) {
      const k = list[i].item_id;
      if (!helpersMap.has(k)) helpersMap.set(k, []);
      const arr = helpersMap.get(k);
      if (arr.length < HITS_MAX) arr.push(list[i].tao || "");
    }
  }

  const gate = await gateOf(env, start, from, uid);
  const gated = gate.need > 0 && helped < gate.need;
  const miss = Math.max(0, gate.need - helped);

  return {
    ok: true,
    tab,
    day: bjDay(now),
    items: rows.map(function (r) { return shape(r, uid, actedSet, helpersMap); }),
    quota: {
      pub: pub, pubMax: PUB_MAX,
      pubTeam: pubTeam, pubTeamMax: PUB_TEAM_MAX,
      helped: helped, helpMax: HELP_MAX,
      need: gate.need,
      miss: miss,
      ownerOpen: gate.ownerOpen,
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
    target = Math.max(TEAM_MIN, Math.min(TEAM_MAX, Number(opts.target) || 3));
    note = name;
  }

  const now = Date.now();
  const start = bjStart(now);
  const from = now - KEEP_MS;
  const ip = String(opts.ip || "").slice(0, 64);

  const chk = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items WHERE uid=? AND kind='help' AND cts>=?").bind(uid, start),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items WHERE uid=? AND kind='team' AND cts>=?").bind(uid, start),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_acts WHERE uid=? AND act='help' AND cts>=?").bind(uid, start),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items WHERE kind='help' AND cts>=?").bind(start),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items WHERE uid=? AND cts>=? AND (word=? OR (link<>'' AND link=?))")
      .bind(uid, start, parsed.word || "-", parsed.link || "-"),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items WHERE ip=? AND kind='help' AND cts>=?").bind(ip, start),
    env.DB.prepare("SELECT COUNT(*) AS c FROM coin_items WHERE ip=? AND kind='team' AND cts>=?").bind(ip, start)
  ]);
  const pub = chk[0].results[0].c || 0;
  const pubTeam = chk[1].results[0].c || 0;
  const helped = chk[2].results[0].c || 0;
  const totalHelp = chk[3].results[0].c || 0;
  const dup = chk[4].results[0].c || 0;
  const ipPub = chk[5].results[0].c || 0;
  const ipPubTeam = chk[6].results[0].c || 0;

  if (dup > 0) return { error: "这条你今天已经发布过了，去广场里点它就能看到" };

  if (kind === "help") {
    if (pub >= PUB_MAX) return { error: "今天已经发布过 1 条口令了（每人每天限 1 条），明天 0 点刷新" };
    if (ipPub >= IP_PUB_MAX) {
      return { error: "这个网络今天已经发布过口令了（每个 IP 每天限 1 条），明天 0 点刷新" };
    }
    const gate = await gateOf(env, start, from, uid);
    const miss = Math.max(0, gate.need - helped);
    if (miss > 0) {
      return {
        error: gate.ownerOpen
          ? "还差 " + miss + " 次助力：去广场帮站长（或别人）复制口令助力一次，回来登记就能发布"
          : "站长名额今天满了，还差 " + miss + " 次助力：帮别人助力 " + gate.need + " 条后才能发布",
        needHelp: miss,
        quota: { pub: pub, helped: helped, need: gate.need, ownerOpen: gate.ownerOpen }
      };
    }
  } else {
    if (pubTeam >= PUB_TEAM_MAX) return { error: "今天发布的队伍够多了（每人每天限 5 支），明天再来" };
    if (ipPubTeam >= IP_PUB_TEAM_MAX) return { error: "这个网络今天发布的队伍太多了（每个 IP 每天限 5 支），明天再来" };
  }

  const id = newId();
  await env.DB.prepare(
    "INSERT INTO coin_items (id,uid,kind,word,link,note,target,hits,ip,cts) VALUES (?,?,?,?,?,?,?,0,?,?)"
  ).bind(id, uid, kind, parsed.word || "", parsed.link || "", note || "", target, ip, now).run();

  return {
    ok: true, id: id, kind: kind,
    word: parsed.word, link: parsed.link, note: note,
    quota: kind === "help"
      ? { pub: pub + 1, pubMax: PUB_MAX, helped: helped, helpMax: HELP_MAX }
      : { pubTeam: pubTeam + 1, pubTeamMax: PUB_TEAM_MAX }
  };
}

/* ============================= 助力 / 入队 ============================= */
export async function coinAct(env, opts) {
  const uid = cleanUid(opts.uid);
  if (!uid) return { error: "缺少用户标识，请刷新页面重试" };
  if (!(await ensureSchema(env))) return { error: "互助数据服务未就绪，稍后再试", soft: true };
  const id = String(opts.id || "").slice(0, 40);
  if (!id) return { error: "缺少条目 id" };
  const tao = sanitizeTao(opts.tao);
  if (!tao) {
    return { error: "助力后请留下你的淘宝昵称（2-20 个字），对方能看到是谁帮了忙" };
  }

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
    "INSERT OR IGNORE INTO coin_acts (item_id,uid,act,ip,cts,tao) VALUES (?,?,?,?,?,?)"
  ).bind(id, uid, act, ip, now, tao).run();
  const changed = (ins && ins.meta && ins.meta.changes) || 0;
  if (!changed) {
    /* 以前登记过没留昵称的，补上 */
    await env.DB.prepare(
      "UPDATE coin_acts SET tao=? WHERE item_id=? AND uid=? AND act=? AND (tao='' OR tao IS NULL)"
    ).bind(tao, id, uid, act).run();
    return {
      ok: true, repeat: true, action: act, hits: item.hits,
      helpers: await helpersOf(env, id),
      quota: { helped: helped, helpMax: HELP_MAX }
    };
  }
  await env.DB.prepare("UPDATE coin_items SET hits=hits+1 WHERE id=?").bind(id).run();

  return {
    ok: true, action: act, hits: item.hits + 1,
    helpers: await helpersOf(env, id),
    quota: { helped: act === "help" ? helped + 1 : helped, helpMax: HELP_MAX }
  };
}

/* 助力者打码列表（助力成功后回给前端刷新卡片） */
async function helpersOf(env, id) {
  try {
    const hr = await env.DB.prepare(
      "SELECT tao FROM coin_acts WHERE item_id=? ORDER BY cts DESC LIMIT 10"
    ).bind(id).all();
    return ((hr && hr.results) || []).map(function (x) { return maskTao(x.tao); }).filter(Boolean);
  } catch (e) { return []; }
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
 * 由 cron 每 30 分钟调用；当天已有 owner 条目就跳过 —— 即「每天更新 10 次助力机会」。
 * 助力满 10 次后当天对新人失效（门槛自动变成助力 3 条），第二天又种新的。 */
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
