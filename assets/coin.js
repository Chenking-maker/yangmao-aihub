/* 羊毛AIHUB · 淘金币互助广场
 * ------------------------------------------------------------
 * 流程：粘贴自己的淘金币口令 → 上榜；帮别人点「复制口令去助力」→ 打开淘宝 →
 *       回来点「我已助力」记 1 次，同时解锁 1 条发布额度。
 * 额度、去重、上限全在 Worker 侧（worker/src/coin.js）判定，前端只做展示。
 * 无登录：本机 localStorage 里生成一个 uid 当作「我」，换浏览器就是另一个身份。
 */
(function () {
  "use strict";

  var W = window.WOOL;
  var $ = W.$;
  var esc = W.esc;

  W.buildTopnav("");

  /* ---------------- 身份（本机匿名 uid） ---------------- */
  function getUid() {
    var k = "ck_coin_uid";
    var v = "";
    try { v = localStorage.getItem(k) || ""; } catch (e) { v = ""; }
    if (!/^[A-Za-z0-9_-]{8,48}$/.test(v)) {
      v = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(k, v); } catch (e) { /* 隐私模式：本次会话内有效 */ }
    }
    return v;
  }

  var S = {
    uid: getUid(),
    tab: "help",
    data: null,
    busy: false,
    lastLoad: 0
  };

  /* ---------------- 小工具 ---------------- */
  function ago(t) {
    var d = Date.now() - t;
    if (d < 0) d = 0;
    if (d < 60000) return "刚刚";
    if (d < 3600000) return Math.floor(d / 60000) + " 分钟前";
    if (d < 86400000) return Math.floor(d / 3600000) + " 小时前";
    return Math.floor(d / 86400000) + " 天前";
  }
  function num(n) { return Number(n) || 0; }
  function setBusy(v) {
    S.busy = v;
    var b = $("pgPubBtn");
    if (b) { b.disabled = v; b.textContent = v ? "处理中…" : "发布到广场"; }
  }

  /* ---------------- 顶部额度 / 提示 ---------------- */
  function paintQuota() {
    var d = S.data;
    if (!d || !d.quota) return;
    var q = d.quota;
    var box = $("pgQuota");
    if (box) {
      box.innerHTML =
        '<span class="pg-q' + (q.pub >= q.pubMax ? " full" : "") + '">发布 <b>' + q.pub + "/" + q.pubMax + "</b></span>" +
        '<span class="pg-q' + (q.helped >= q.helpMax ? " full" : "") + '">助力 <b>' + q.helped + "/" + q.helpMax + "</b></span>";
    }
    var hint = $("pgHint");
    if (!hint) return;
    hint.className = "pg-hint";
    if (q.pub >= q.pubMax) {
      hint.textContent = "今天的 " + q.pubMax + " 条发布额度用完了，明天 0 点刷新";
    } else if (q.gated) {
      hint.textContent = "还差 " + q.miss + " 次助力：帮别人点一下再回来登记，就能发一条";
      hint.className = "pg-hint warn";
    } else if (q.helped >= q.helpMax) {
      hint.textContent = "今天 " + q.helpMax + " 次助力额度用完了，还能发 " + (q.pubMax - q.pub) + " 条";
    } else {
      hint.textContent = "还能发 " + (q.pubMax - q.pub) + " 条 · 已帮 " + q.helped + " 人助力（帮 1 人 = 1 条额度）";
    }

    var ch = $("pgCntHelp"), ct = $("pgCntTeam");
    if (ch && d.stats) ch.textContent = d.stats.help;
    if (ct && d.stats) ct.textContent = d.stats.team;
  }

  /* ---------------- 卡片 ---------------- */
  function cardHtml(it) {
    var isTeam = it.kind === "team";
    var target = isTeam ? Math.max(1, num(it.target)) : num(S.data && S.data.quota ? S.data.quota.hitsMax : 10);
    var hits = num(it.hits);
    var pct = Math.min(100, Math.round((hits / target) * 100));

    var tags = [];
    if (it.owner) tags.push('<span class="pg-tag owner">站长推荐</span>');
    tags.push(isTeam ? '<span class="pg-tag team">组队</span>' : '<span class="pg-tag">互助</span>');
    if (it.mine) tags.push('<span class="pg-tag owner">我的</span>');

    var cls = "pg-card" + (it.mine ? " mine" : "") + (it.acted ? " done" : "");
    var head = '<div class="pg-top">' + tags.join("") + '<span class="pg-time">' + ago(it.cts) + "</span></div>";

    var body = "";
    if (isTeam) {
      body += '<div class="pg-name">' + esc(it.note || "淘金币组队") + "</div>";
      if (it.word) body += '<div class="pg-word">' + esc(it.word) + "</div>";
      if (it.link) body += '<div class="pg-note">' + esc(it.link) + "</div>";
    } else {
      body += '<div class="pg-word">' + esc(it.word || it.link || "（未识别到口令）") + "</div>";
      if (it.word && it.link) body += '<div class="pg-note">' + esc(it.link) + "</div>";
      else if (it.note) body += '<div class="pg-note">' + esc(it.note) + "</div>";
    }

    var bar = '<div class="pg-bar' + (isTeam ? "" : " help") + '"><i style="width:' + pct + '%"></i></div>';
    var meta = isTeam
      ? '<div class="pg-meta">已加入 <b>' + hits + "/" + target + "</b> 人" + (hits >= target ? " · 已满员" : "") + "</div>"
      : '<div class="pg-meta">已被助力 <b>' + hits + "/" + target + "</b> 次" + (it.full ? " · 今天满了" : "") + "</div>";

    var acts = "";
    if (it.mine) {
      acts = '<button class="pg-sbtn" data-a="copy">复制口令</button>' +
             '<button class="pg-sbtn" data-a="del">删除这条</button>';
    } else if (it.acted) {
      acts = '<button class="pg-sbtn ok" disabled>✓ 已' + (isTeam ? "入队" : "助力") + "</button>" +
             '<button class="pg-sbtn" data-a="copy">再复制一次</button>';
    } else {
      acts = '<button class="pg-sbtn pri" data-a="go">' + (isTeam ? "复制口令入队" : "复制口令去助力") + "</button>" +
             '<button class="pg-sbtn" data-a="done">我已' + (isTeam ? "入队" : "助力") + " · 记 1 次</button>";
    }

    return '<article class="' + cls + '" data-id="' + esc(it.id) + '">' + head + body + bar + meta +
           '<div class="pg-card-acts">' + acts + "</div></article>";
  }

  function paintList() {
    var box = $("pgList");
    if (!box) return;
    var d = S.data;
    if (!d) return;
    if (d.error) {
      box.innerHTML = '<div class="pg-empty"><b>🛠</b>' + esc(d.error) +
        "<br><span style=\"font-size:12px\">刷新一下试试，或稍后再来</span></div>";
      return;
    }
    var items = (d.items || []).filter(function (x) { return x.kind === S.tab; });
    if (!items.length) {
      box.innerHTML = S.tab === "team"
        ? '<div class="pg-empty"><b>👥</b>还没有人组队<br>发一条队伍口令，等人来凑</div>'
        : '<div class="pg-empty"><b>🫙</b>广场还是空的<br>把你的口令发第一条，别人进来就会先帮你点</div>';
      return;
    }
    /* 未助力、没满的排前面（让每个人都有机会被人点到） */
    items.sort(function (a, b) {
      if (a.mine !== b.mine) return a.mine ? 1 : -1;
      if (a.acted !== b.acted) return a.acted ? 1 : -1;
      if (a.full !== b.full) return a.full ? 1 : -1;
      return b.cts - a.cts;
    });
    box.innerHTML = items.map(cardHtml).join("");
  }

  function repaint() { paintQuota(); paintList(); }

  /* ---------------- 拉数据 ---------------- */
  function load(silent) {
    if (S.busy) return Promise.resolve(S.data);
    return W.apiGet("/api/coin/board?uid=" + encodeURIComponent(S.uid) + "&tab=" + S.tab)
      .then(function (d) {
        S.data = d || { error: "接口没有返回数据" };
        S.lastLoad = Date.now();
        repaint();
        return S.data;
      })
      .catch(function (e) {
        if (!silent) {
          S.data = { error: "连不上互助服务（" + String((e && e.message) || e) + "）" };
          repaint();
        }
        return S.data;
      });
  }

  /* ---------------- 发布 ---------------- */
  function publish() {
    if (S.busy) return;
    var ta = $("pgText");
    var text = (ta && ta.value || "").trim();
    if (!text) { W.toast("先把淘口令或链接粘进来"); if (ta) ta.focus(); return; }
    if (!/https?:\/\//i.test(text) && !/[￥¥€£$₤₩₽]/.test(text)) {
      W.toast("没识别到口令，请在淘宝里点「分享 → 复制链接」再整段粘贴");
      return;
    }
    var payload = { uid: S.uid, text: text, kind: S.tab };
    if (S.tab === "team") {
      var nm = ($("pgTeamName") || {}).value || "";
      if (!nm.trim()) { W.toast("先给队伍起个名字"); return; }
      payload.name = nm.trim();
      payload.target = Number(($("pgTeamTarget") || {}).value || 3);
    }
    setBusy(true);
    W.apiPost("/api/coin/publish", payload).then(function (r) {
      setBusy(false);
      if (!r || r.error) {
        W.toast(r && r.error ? r.error : "发布失败，稍后再试");
        load(true);
        return;
      }
      W.toast("已发布，去下面帮别人点一下换额度");
      if (ta) ta.value = "";
      try { localStorage.removeItem("ck_coin_draft"); } catch (e) { /* ignore */ }
      load(true);
    }).catch(function (e) {
      setBusy(false);
      W.toast("发布失败：" + String((e && e.message) || e));
    });
  }

  /* ---------------- 助力 / 入队 ---------------- */
  function findItem(id) {
    var arr = (S.data && S.data.items) || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  function doGo(it) {
    var txt = it.word || it.link || "";
    if (!txt) { W.toast("这条没口令，点复制链接吧"); return; }
    /* 开窗必须同步触发（异步里 window.open 会被浏览器拦） */
    if (it.link) { try { window.open(it.link, "_blank", "noopener"); } catch (e) { /* ignore */ } }
    W.copyText(txt, it.kind === "team" ? "口令已复制，打开淘宝就能入队" : "口令已复制，打开淘宝就完成助力了");
    /* 提示用户点「我已助力」 */
    var card = document.querySelector('.pg-card[data-id="' + it.id + '"]');
    if (card) {
      var btn = card.querySelector('[data-a="done"]');
      if (btn) { btn.classList.add("pri"); btn.textContent = "点这里登记 ✓"; }
    }
  }

  function doDone(it, btn) {
    if (S.busy) return;
    S.busy = true;
    if (btn) { btn.disabled = true; btn.textContent = "登记中…"; }
    W.apiPost("/api/coin/act", { uid: S.uid, id: it.id }).then(function (r) {
      S.busy = false;
      if (!r || r.error) {
        W.toast(r && r.error ? r.error : "登记失败，稍后再试");
        if (btn) { btn.disabled = false; btn.textContent = "我已助力 · 记 1 次"; }
        return;
      }
      it.acted = true;
      it.hits = num(r.hits);
      if (!r.repeat) W.toast("已记 1 次，发布额度 +1");
      else W.toast("这条你已经登记过了");
      if (S.data && S.data.quota && r.quota) {
        var q = S.data.quota;
        q.helped = num(r.quota.helped);
        q.miss = Math.max(0, num(q.need) - q.helped);
        if (q.miss === 0) q.gated = false;          /* 额度补齐就解锁发布 */
        q.canPub = q.pub < q.pubMax && !q.gated;
      }
      repaint();
    }).catch(function (e) {
      S.busy = false;
      W.toast("登记失败：" + String((e && e.message) || e));
      if (btn) { btn.disabled = false; btn.textContent = "我已助力 · 记 1 次"; }
    });
  }

  function doDel(it) {
    if (!window.confirm("删除这条？删掉之后别人就看不到你的口令了。")) return;
    W.apiPost("/api/coin/del", { uid: S.uid, id: it.id }).then(function (r) {
      if (r && r.error) { W.toast(r.error); return; }
      W.toast("已删除");
      load(true);
    }).catch(function () { W.toast("删除失败，稍后再试"); });
  }

  /* ---------------- 事件 ---------------- */
  var list = $("pgList");
  if (list) {
    list.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-a]") : null;
      if (!btn) return;
      var card = btn.closest(".pg-card");
      if (!card) return;
      var it = findItem(card.getAttribute("data-id"));
      if (!it) return;
      var a = btn.getAttribute("data-a");
      if (a === "go") doGo(it);
      else if (a === "done") doDone(it, btn);
      else if (a === "copy") W.copyText(it.word || it.link || "", "口令已复制");
      else if (a === "del") doDel(it);
    });
  }

  var pubBtn = $("pgPubBtn");
  if (pubBtn) pubBtn.addEventListener("click", publish);

  var pasteBtn = $("pgPasteBtn");
  if (pasteBtn) pasteBtn.addEventListener("click", function () {
    var ta = $("pgText");
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (t) {
        if (!t) { W.toast("剪贴板是空的"); return; }
        if (ta) { ta.value = t.trim().slice(0, 600); ta.focus(); }
        W.toast("已粘贴");
      }).catch(function () { W.toast("浏览器不让读剪贴板，请长按输入框手动粘贴"); });
    } else {
      W.toast("请长按输入框手动粘贴");
    }
  });

  /* Tab 切换：team 时多出队伍名/人数 */
  var tabs = document.querySelectorAll(".pg-tab");
  Array.prototype.forEach.call(tabs, function (b) {
    b.addEventListener("click", function () {
      var t = b.getAttribute("data-tab");
      if (t === S.tab) return;
      S.tab = t;
      Array.prototype.forEach.call(tabs, function (x) { x.classList.toggle("active", x === b); });
      var tf = $("pgTeamForm");
      if (tf) tf.hidden = t !== "team";
      var pt = $("pgPubTitle");
      if (pt) pt.textContent = t === "team" ? "发布我的组队信息" : "发布我的淘金币口令";
      var hint = $("pgHint");
      load(false);
      if (hint) hint.textContent = "加载中…";
    });
  });

  /* 草稿记忆：换个页面再回来不丢口令 */
  var ta = $("pgText");
  if (ta) {
    try { ta.value = localStorage.getItem("ck_coin_draft") || ""; } catch (e) { /* ignore */ }
    ta.addEventListener("input", function () {
      clearTimeout(ta._t);
      ta._t = setTimeout(function () {
        try { localStorage.setItem("ck_coin_draft", ta.value.slice(0, 600)); } catch (e) { /* ignore */ }
      }, 400);
    });
  }

  var more = $("pgMore");
  if (more) {
    more.hidden = false;
    more.addEventListener("click", function () {
      more.textContent = "刷新中…";
      load(false).then(function () {
        more.textContent = "刷新看看新的";
        W.toast("已刷新");
      });
    });
  }

  /* 站着不动也会有人新发布：可见时每分钟静默刷新一次 */
  setInterval(function () {
    if (document.visibilityState !== "visible") return;
    if (S.busy) return;
    if (Date.now() - S.lastLoad < 55000) return;
    load(true);
  }, 60000);

  load(false);
})();
