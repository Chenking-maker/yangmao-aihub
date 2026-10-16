/* 羊毛AIHUB · 凑单工具 v2.2（仿大淘客凑单交互）
 * 添加商品（粘贴链接解析 / 关键词搜索 / 手动）→ 已选列表算差额 → 智能补差推荐
 * 所有商品的领券购买统一走 /api/coupon（ratesurl 转链，带用户归因参数）
 * 已选列表持久化到 localStorage，刷新不丢
 */
(function () {
  "use strict";
  /* 图片三级降级：缩放图 → 代理 → 原图 → 占位（两大图床原图 100~300KB，
   * 而这里只按 48px 展示，所以统一按 112px 请求缩放图） */
  function bindCtImgs(root) {
    (root || document).querySelectorAll("img.ct-img").forEach(function (img) {
      W.bindImgFallback(img, img.getAttribute("data-orig") || "", img.parentNode, "图");
    });
  }
  var W = window.WOOL;
  var $ = W.$;

  W.buildTopnav("");

  var API_BASE = W.API_BASE;
  function apiGet(p) { return fetch(API_BASE + p).then(function (r) { return r.json(); }); }
  function apiPost(p, b) {
    return fetch(API_BASE + p, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(b || {})
    }).then(function (r) { return r.json(); });
  }
  function toast(msg) { W.toast(msg); }
  function esc(s) { return W.esc(s); }
  function fmt(n) { return (Math.round(Number(n) * 100) / 100).toFixed(1).replace(/\.0$/, ""); }

  /* ---------- 状态 ---------- */
  var LS_KEY = "wool-coutao-v1";
  var state = { items: [], rule: { per: 200, cut: 20 }, pool: [], poolLoaded: false, manualSeq: 0 };

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ items: state.items, rule: state.rule })); } catch (e) {}
  }
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      if (d && Array.isArray(d.items)) {
        state.items = d.items;
        if (d.rule) state.rule = { per: Number(d.rule.per) || 200, cut: Number(d.rule.cut) || 20 };
      }
    } catch (e) {}
  }

  function total() {
    return state.items.reduce(function (s, it) { return s + Number(it.endPrice || 0) * (Number(it.qty) || 1); }, 0);
  }
  function count() {
    return state.items.reduce(function (s, it) { return s + (Number(it.qty) || 1); }, 0);
  }

  /* ---------- 已选列表 ---------- */
  function addItem(p, silent) {
    var key = p.id || ("m" + (++state.manualSeq));
    for (var i = 0; i < state.items.length; i++) {
      if ((state.items[i].id || state.items[i].key) === key) {
        state.items[i].qty = (Number(state.items[i].qty) || 1) + 1;
        save(); renderAll();
        if (!silent) toast("已在列表里，数量 +1");
        return;
      }
    }
    var item = {
      key: key,
      id: p.id || "",
      title: p.title || "未命名商品",
      pic: p.pic || "",
      price: p.price || p.endPrice || "0",
      endPrice: p.endPrice || p.price || "0",
      coupon: Number(p.coupon) || 0,
      manual: !!p.manual,
      qty: 1
    };
    state.items.push(item);
    save(); renderAll();
    if (!silent) toast("已加入凑单： " + item.title.slice(0, 12));
  }

  function renderRows() {
    var box = $("ctRows");
    box.innerHTML = "";
    $("ctCount").textContent = count() + " 件";
    if (!state.items.length) {
      box.innerHTML = '<div class="ct-empty">还没有产品。上面粘贴链接、搜关键词，或手动添加都行 ›</div>';
      return;
    }
    state.items.forEach(function (it, idx) {
      var row = document.createElement("div");
      row.className = "ct-row" + (it.manual ? " manual" : "");
      var img = it.pic
        ? '<img class="ct-img" width="48" height="48" src="' + W.imgThumb(it.pic, 112) + '" data-orig="' + W.esc(it.pic) + '" referrerpolicy="no-referrer" alt="">'
        : '<span class="ct-row-noimg">图</span>';
      row.innerHTML =
        '<div class="ct-row-img">' + img + '</div>' +
        '<div class="ct-row-main">' +
          '<div class="ct-row-title">' + esc(it.title) + (it.manual ? '<span class="ct-row-tag">手动</span>' : "") + '</div>' +
          '<div class="ct-row-price">' +
            '<span class="ct-row-now">¥' + fmt(it.endPrice) + '</span>' +
            (Number(it.price) > Number(it.endPrice) ? '<span class="ct-row-old">¥' + fmt(it.price) + '</span>' : "") +
            (it.coupon > 0 ? '<span class="ct-row-coupon">券 ¥' + it.coupon + '</span>' : "") +
          '</div>' +
        '</div>' +
        '<div class="ct-row-qty">' +
          '<button class="ct-qty-btn" data-act="minus">−</button>' +
          '<input type="number" min="1" value="' + (Number(it.qty) || 1) + '" data-idx="' + idx + '" class="ct-qty-input">' +
          '<button class="ct-qty-btn" data-act="plus">＋</button>' +
        '</div>' +
        '<button class="ct-row-del" data-act="del" title="移除">✕</button>';
      row.querySelector('[data-act="del"]').addEventListener("click", function () {
        state.items.splice(idx, 1); save(); renderAll();
      });
      row.querySelector('[data-act="minus"]').addEventListener("click", function () {
        it.qty = Math.max(1, (Number(it.qty) || 1) - 1); save(); renderAll();
      });
      row.querySelector('[data-act="plus"]').addEventListener("click", function () {
        it.qty = (Number(it.qty) || 1) + 1; save(); renderAll();
      });
      row.querySelector(".ct-qty-input").addEventListener("change", function () {
        var v = Math.max(1, Math.floor(Number(this.value) || 1));
        it.qty = v; save(); renderAll();
      });
      box.appendChild(row);
      bindCtImgs(row);
    });
  }

  /* ---------- 汇总 ---------- */
  function renderSummary() {
    var t = total();
    var per = Math.max(1, Number($("ctPer").value) || 200);
    var cut = Math.max(0, Number($("ctCut").value) || 0);
    var save_ = Math.floor(t / per) * cut;
    var gap = t > 0 && t % per !== 0 ? per - (t % per) : 0;
    var html =
      '<div class="ct-sum-item"><span class="ct-sum-num">' + count() + '</span><span class="ct-sum-lbl">已选件数</span></div>' +
      '<div class="ct-sum-item"><span class="ct-sum-num">¥' + fmt(t) + '</span><span class="ct-sum-lbl">券后合计</span></div>' +
      '<div class="ct-sum-item"><span class="ct-sum-num ' + (gap > 0 ? "warn" : "ok") + '">' + (gap > 0 ? "¥" + fmt(gap) : "已达标 ✔") + '</span><span class="ct-sum-lbl">' + (gap > 0 ? "距下一档还差" : "满减门槛") + '</span></div>' +
      '<div class="ct-sum-item"><span class="ct-sum-num save">¥' + fmt(save_) + '</span><span class="ct-sum-lbl">预计可省</span></div>';
    $("ctSummary").innerHTML = html;
    return { total: t, gap: gap, save: save_, per: per, cut: cut };
  }

  /* ---------- 智能补差推荐 ---------- */
  function recCard(p, gap) {
    var el = document.createElement("div");
    var endPrice = Number(p.endPrice) || 0;
    var img = p.pic
      ? '<img class="ct-img" width="48" height="48" src="' + W.imgThumb(p.pic, 112) + '" data-orig="' + W.esc(p.pic) + '" referrerpolicy="no-referrer" alt="">'
      : '<span class="ct-row-noimg">图</span>';
    var left = gap - endPrice;
    el.className = "ct-rec";
    el.innerHTML =
      '<div class="ct-rec-img">' + img + '</div>' +
      '<div class="ct-rec-main">' +
        '<div class="ct-rec-title">' + esc(p.title) + '</div>' +
        '<div class="ct-rec-price"><span class="ct-row-now">¥' + fmt(endPrice) + '</span>' +
        (Number(p.price) > endPrice ? '<span class="ct-row-old">¥' + fmt(p.price) + '</span>' : "") +
        (Number(p.coupon) > 0 ? '<span class="ct-row-coupon">券 ¥' + p.coupon + '</span>' : "") + '</div>' +
        '<div class="ct-rec-badge">' + (left > 0 ? "凑上还差 ¥" + fmt(left) : "刚好达标 ✔") + '</div>' +
      '</div>' +
      '<button class="ct-btn small primary">＋ 加入</button>';
    el.querySelector("button").addEventListener("click", function () { addItem(p); });
    return el;
  }

  function renderRecommend() {
    var s = renderSummary();
    var box = $("ctRecList");
    var tip = $("ctRecTip");
    box.innerHTML = "";
    if (!state.items.length) { tip.textContent = "加满产品后，这里按差额推荐刚好补差的商品。"; return; }
    if (s.gap <= 0) { tip.textContent = "已达标，满减拿满了 ✔ 想再买点啥可以继续加。"; return; }
    if (!state.poolLoaded) {
      tip.textContent = "推荐池加载中…";
      loadPool();
      return;
    }
    var fits = state.pool
      .filter(function (p) { return Number(p.endPrice) > 0 && Number(p.endPrice) <= s.gap; })
      .sort(function (a, b) { return Number(b.endPrice) - Number(a.endPrice); })
      .slice(0, 8);
    if (!fits.length) {
      tip.textContent = "还差 ¥" + fmt(s.gap) + "，推荐池里没匹配的，换个关键词搜着加 ›";
      return;
    }
    tip.textContent = "还差 ¥" + fmt(s.gap) + " 拿满「每满 " + s.per + " 减 " + s.cut + "」，这些商品刚好补差（按到手价从高到低）：";
    fits.forEach(function (p) { var c = recCard(p, s.gap); box.appendChild(c); bindCtImgs(c); });
  }

  function loadPool() {
    if (state.poolLoaded) { renderRecommend(); return; }
    Promise.all([
      apiGet("/api/feed?type=2").catch(function () { return []; }),
      apiGet("/api/feed?type=4").catch(function () { return []; })
    ]).then(function (rs) {
      var seen = {};
      var pool = [];
      rs.forEach(function (list) {
        (Array.isArray(list) ? list : []).forEach(function (p) {
          if (p.id && !seen[p.id]) { seen[p.id] = 1; pool.push(p); }
        });
      });
      state.pool = pool;
      state.poolLoaded = true;
      renderRecommend();
    }).catch(function () {
      $("ctRecTip").textContent = "推荐池加载失败，刷新页面试试";
    });
  }

  /* ---------- 添加商品：解析 / 搜索 / 手动 ---------- */
  $("ctParseBtn").addEventListener("click", function () {
    var raw = $("ctPaste").value.trim();
    if (!raw) { toast("先粘贴淘宝链接或淘口令"); return; }
    var lines = raw.split(/\s+/).filter(Boolean).slice(0, 10);
    var btn = this;
    btn.disabled = true; btn.textContent = "解析中…";
    var done = 0, added = 0, failed = 0;
    lines.forEach(function (line) {
      apiPost("/api/parse", { text: line }).then(function (r) {
        if (r && r.title && !r.manual) { addItem(r, true); added++; }
        else if (r && r.manual) { failed++; toast(r.note || "这条识别不了，用手动添加"); }
        else failed++;
      }).catch(function () { failed++; })
        .then(function () {
          if (++done >= lines.length) {
            btn.disabled = false; btn.textContent = "解析添加";
            $("ctPaste").value = "";
            toast(added ? "解析完成：加入 " + added + " 件" + (failed ? "，" + failed + " 条没识别" : "") : "一条都没识别出来，检查链接或用手动添加");
          }
        });
    });
  });

  $("ctSearchBtn").addEventListener("click", function () {
    var kw = $("ctKw").value.trim();
    if (!kw) { toast("先输入关键词"); return; }
    var box = $("ctSearchResult"), list = $("ctSrList");
    box.style.display = "";
    list.innerHTML = '<div class="empty-note">搜索中…</div>';
    apiGet("/api/search?q=" + encodeURIComponent(kw)).then(function (rs) {
      list.innerHTML = "";
      var arr = Array.isArray(rs) ? rs : [];
      if (!arr.length) { list.innerHTML = '<div class="empty-note">没搜到，换个关键词 ›</div>'; return; }
      arr.slice(0, 12).forEach(function (p) {
        var el = document.createElement("div");
        el.className = "ct-sr-item";
        var img = p.pic
          ? '<img class="ct-img" width="48" height="48" src="' + W.imgThumb(p.pic, 112) + '" data-orig="' + W.esc(p.pic) + '" referrerpolicy="no-referrer" alt="">'
          : '<span class="ct-row-noimg">图</span>';
        el.innerHTML =
          '<div class="ct-rec-img">' + img + '</div>' +
          '<div class="ct-rec-main">' +
            '<div class="ct-rec-title">' + esc(p.title) + '</div>' +
            '<div class="ct-rec-price"><span class="ct-row-now">¥' + fmt(p.endPrice) + '</span>' +
            (Number(p.coupon) > 0 ? '<span class="ct-row-coupon">券 ¥' + p.coupon + '</span>' : "") + '</div>' +
          '</div>' +
          '<button class="ct-btn small primary">＋ 加入</button>';
        el.querySelector("button").addEventListener("click", function () { addItem(p); });
        list.appendChild(el);
        bindCtImgs(el);
      });
    }).catch(function () {
      list.innerHTML = '<div class="empty-note">网络开小差了，重试 ›</div>';
    });
  });
  $("ctSrClose").addEventListener("click", function () { $("ctSearchResult").style.display = "none"; });

  $("ctManualBtn").addEventListener("click", function () {
    var name = $("ctManualName").value.trim();
    var price = Number($("ctManualPrice").value) || 0;
    if (!name) { toast("先填商品名称"); return; }
    if (price <= 0) { toast("填一下到手价"); return; }
    addItem({ id: "", title: name, endPrice: price, price: price, manual: true });
    $("ctManualName").value = ""; $("ctManualPrice").value = "";
  });

  /* ---------- 规则变更 ---------- */
  $("ctPer").addEventListener("input", function () { state.rule.per = Number(this.value) || 200; save(); renderRecommend(); });
  $("ctCut").addEventListener("input", function () { state.rule.cut = Number(this.value) || 0; save(); renderRecommend(); });

  function renderAll() { renderRows(); renderRecommend(); }

  /* ---------- 启动 ---------- */
  load();
  $("ctPer").value = state.rule.per;
  $("ctCut").value = state.rule.cut;
  renderAll();
})();
