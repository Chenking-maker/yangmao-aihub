/* 羊毛AIHUB · 凑单工具 v2.21（今年规则：淘宝每满200减25）
 * 添加商品（粘贴链接解析 / 关键词搜索 / 手动）→ 已选列表算差额 → 智能补差推荐
 * 补差推荐走 /api/coutao/rec（服务端按差额向好单库商品筛选 API 要价格区间商品）
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
  var LS_KEY = "wool-coutao-v2";   // v2：今年规则改成 200-25，旧 key（200-20）不迁移
  var state = { items: [], rule: { per: 200, cut: 25 }, pool: [], poolLoaded: false, manualSeq: 0 };

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ items: state.items, rule: state.rule })); } catch (e) {}
  }
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      if (d && Array.isArray(d.items)) {
        state.items = d.items;
        if (d.rule) state.rule = { per: Number(d.rule.per) || 200, cut: Number(d.rule.cut) || 25 };
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
        /* 购物车总价条目：重复提交 = 更新价格，不是加数量 */
        if (state.items[i].virtual) {
          state.items[i].endPrice = p.endPrice;
          state.items[i].price = p.endPrice;
          save(); renderAll();
          if (!silent) toast("购物车总价已更新为 ¥" + fmt(p.endPrice));
          return;
        }
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
      virtual: !!p.virtual,
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
      row.className = "ct-row" + (it.manual ? " manual" : "") + (it.virtual ? " virtual" : "");
      var img = it.pic
        ? '<img class="ct-img" width="48" height="48" src="' + W.imgThumb(it.pic, 112) + '" data-orig="' + W.esc(it.pic) + '" referrerpolicy="no-referrer" alt="">'
        : '<span class="ct-row-noimg">' + (it.virtual ? "🛒" : "图") + '</span>';
      /* 购物车总价条目：价格直接可改，不用删了重填 */
      var priceHtml = it.virtual
        ? '<span class="ct-cart-edit-wrap">¥<input type="number" min="0" step="0.01" value="' + (Number(it.endPrice) || 0) + '" class="ct-cart-edit" title="改购物车总价"></span>'
        : '<span class="ct-row-now">¥' + fmt(it.endPrice) + '</span>' +
          (Number(it.price) > Number(it.endPrice) ? '<span class="ct-row-old">¥' + fmt(it.price) + '</span>' : "") +
          (it.coupon > 0 ? '<span class="ct-row-coupon">券 ¥' + it.coupon + '</span>' : "");
      var tagHtml = it.virtual
        ? '<span class="ct-row-tag cart">总价</span>'
        : (it.manual ? '<span class="ct-row-tag">手动</span>' : "");
      row.innerHTML =
        '<div class="ct-row-img">' + img + '</div>' +
        '<div class="ct-row-main">' +
          '<div class="ct-row-title">' + esc(it.title) + tagHtml + '</div>' +
          '<div class="ct-row-price">' + priceHtml + '</div>' +
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
      var edit = row.querySelector(".ct-cart-edit");
      if (edit) {
        edit.addEventListener("change", function () {
          var v = Math.max(0, Number(this.value) || 0);
          it.endPrice = v; it.price = v; save(); renderAll();
          toast("购物车总价已更新为 ¥" + fmt(v));
        });
      }
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

  /* 差额 → 商品推荐。
   * v2.21 起改走 /api/coutao/rec：服务端拿「差额 ±」直接向好单库商品筛选 API 要
   * 价格区间商品（v2 column 的 price_min/price_max），比原来拉两个固定榜单再本地
   * 筛准得多（原来经常「推荐池里没匹配的」）。接口挂了才回退老推荐池。 */
  function paintRec(s, items, tip, box) {
    box.innerHTML = "";
    var fits = items
      .filter(function (p) { return Number(p.endPrice) > 0; })
      /* 越贴近差额的排越前（刚好达标 > 差一点 > 超一点） */
      .sort(function (a, b) {
        return Math.abs(Number(a.endPrice) - s.gap) - Math.abs(Number(b.endPrice) - s.gap);
      })
      .slice(0, 8);
    if (!fits.length) {
      tip.textContent = "还差 ¥" + fmt(s.gap) + "，没挑到合适的，换个关键词搜着加 ›";
      return;
    }
    tip.textContent = "还差 ¥" + fmt(s.gap) + " 拿满「每满 " + s.per + " 减 " + s.cut + "」，这些是挑好的补差商品（越靠前越刚好）：";
    fits.forEach(function (p) { var c = recCard(p, s.gap); box.appendChild(c); bindCtImgs(c); });
  }

  function renderRecommend() {
    var s = renderSummary();
    var box = $("ctRecList");
    var tip = $("ctRecTip");
    box.innerHTML = "";
    if (!state.items.length) { tip.textContent = "加满产品后，这里按差额推荐刚好补差的商品。"; return; }
    if (s.gap <= 0) { tip.textContent = "已达标，满减拿满了 ✔ 想再买点啥可以继续加。"; return; }
    /* 同一差额直接用刚拉的结果，不重复请求 */
    if (state.rec && state.rec.gap === s.gap) { paintRec(s, state.rec.items, tip, box); return; }
    if (state.recLoading) { tip.textContent = "正在按差额挑商品…"; return; }
    state.recLoading = true;
    tip.textContent = "正在按差额挑商品…";
    apiGet("/api/coutao/rec?gap=" + s.gap).then(function (d) {
      state.recLoading = false;
      var items = (d && d.items) || [];
      state.rec = { gap: s.gap, items: items };
      paintRec(s, items, tip, box);
    }).catch(function () {
      state.recLoading = false;
      /* 接口挂了：回退老推荐池（本地按差额筛） */
      if (!state.poolLoaded) { tip.textContent = "推荐池加载中…"; loadPool(); return; }
      var fits = state.pool.filter(function (p) { return Number(p.endPrice) > 0 && Number(p.endPrice) <= s.gap; });
      paintRec(s, fits, tip, box);
    });
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

  /* ---------- 添加商品：购物车总价 / 解析 / 搜索 / 手动 ---------- */

  /* 购物车总价模式：填个数就行，差额计算、补差推荐全部复用现有链路 */
  $("ctCartBtn").addEventListener("click", function () {
    var v = Number($("ctCartTotal").value) || 0;
    if (v <= 0) { toast("先填购物车总价"); $("ctCartTotal").focus(); return; }
    addItem({ id: "__cart", title: "购物车总价", endPrice: v, price: v, manual: true, virtual: true });
    $("ctCartTotal").value = "";
  });
  $("ctCartTotal").addEventListener("keydown", function (e) {
    if (e.key === "Enter") $("ctCartBtn").click();
  });

  /* 从粘贴文本里提取商品名（剃 URL/口令/【标签】，与 AI 对话同款逻辑的精简版） */
  function extractName(text) {
    var s = String(text || "");
    s = s.replace(/https?:\/\/\S+/g, " ");
    s = s.replace(/[\u4e00-\u9fa5A-Za-z0-9]{0,4}[A-Za-z0-9]{4,14}\/[A-Za-z0-9]{5,24}\/?\s*(?::\/\/)?[\s\S]{0,18}?,?\s*打[\u958b\u5f00]\/?/g, " ");
    s = s.replace(/[\u20a3\u00a3\u00a5\uffe5$\u20ac][^\s\u20a3\u00a3\u00a5\uffe5$\u20ac]{5,40}[\u20a3\u00a3\u00a5\uffe5$\u20ac]/g, " ");
    s = s.replace(/\u301a[^\u301a\u301b]{1,40}\u301b/g, " ");
    var segs = s.split(/[\s,\uff0c\u3002\u3001!!\uff1f??;;\u3010\u3011~\u301c|]+/).filter(function (x) {
      return x && x.length >= 4 && /[\u4e00-\u9fa5]/.test(x) && x.replace(/[0-9.\s]/g, "").length >= 3;
    });
    return segs.length ? segs.sort(function (a, b) { return b.length - a.length; })[0].slice(0, 40) : "";
  }
  /* 从粘贴文本里提取价格数字（到手价/券面额/XX 元，取第一个合理的） */
  function extractPrice(text) {
    var s = String(text || "");
    var m = s.match(/\u5230\u624b\u4ef7\u3010?\s*[:\uff1a]?\s*[\u00a5\uffe5]?\s*(\d+(?:\.\d{1,2})?)/) ||
      s.match(/[\u00a5\uffe5]\s*(\d+(?:\.\d{1,2})?)\s*\u5143/) ||
      s.match(/(\d+(?:\.\d{1,2})?)\s*\u5143/);
    if (m && Number(m[1]) > 0.5) return Number(m[1]);
    return 0;
  }

  $("ctParseBtn").addEventListener("click", function () {
    var raw = $("ctPaste").value.trim();
    if (!raw) { toast("先粘贴淘宝商品链接"); return; }
    /* 按换行拆（一段一个商品）——不能按空格拆：整段分享文案里
     * 「商品名【包邮】 【到手价】 534.00 元 口令」一按空格就碎，
     * 价格和名称会被拆到不同行，兜底提取就废了 */
    var lines = raw.split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 10);
    var btn = this;
    btn.disabled = true; btn.textContent = "解析中…";
    var done = 0, added = 0, failed = 0, priceAdded = 0;
    lines.forEach(function (line) {
      apiPost("/api/parse", { text: line }).then(function (r) {
        if (r && r.title && !r.manual) { addItem(r, true); added++; }
        else {
          /* 解析失败兜底：整段文案（线报/分享文本）里抠「到手价」和商品名，
           * 按手动条目加入——手机复制的短链/口令解析不出商品 ID，但价格能用 */
          var price = extractPrice(line);
          var name = extractName(line);
          if (price > 0) {
            addItem({ id: "", title: name || "粘贴的商品", endPrice: price, price: price, manual: true }, true);
            priceAdded++;
          } else failed++;
        }
      }).catch(function () {
        var price = extractPrice(line);
        var name = extractName(line);
        if (price > 0) { addItem({ id: "", title: name || "粘贴的商品", endPrice: price, price: price, manual: true }, true); priceAdded++; }
        else failed++;
      })
        .then(function () {
          if (++done >= lines.length) {
            btn.disabled = false; btn.textContent = "解析添加";
            $("ctPaste").value = "";
            var msg = [];
            if (added) msg.push("解析加入 " + added + " 件");
            if (priceAdded) msg.push("按文案到手价加入 " + priceAdded + " 件");
            if (failed) msg.push(failed + " 条没识别（短链/口令解析不出商品，可用购物车总价或手动添加）");
            toast(msg.join("，") || "一条都没识别出来");
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
  function syncPresets() {
    var per = Number($("ctPer").value) || 200, cut = Number($("ctCut").value) || 0;
    document.querySelectorAll(".ct-preset").forEach(function (x) {
      x.classList.toggle("active",
        Number(x.getAttribute("data-per")) === per && Number(x.getAttribute("data-cut")) === cut);
    });
  }
  $("ctPer").addEventListener("input", function () { state.rule.per = Number(this.value) || 200; save(); syncPresets(); renderRecommend(); });
  $("ctCut").addEventListener("input", function () { state.rule.cut = Number(this.value) || 0; save(); syncPresets(); renderRecommend(); });

  /* ---------- 平台预设（今年双11 各平台跨店满减，一键切换） ---------- */
  document.querySelectorAll(".ct-preset").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var per = Number(btn.getAttribute("data-per")) || 200;
      var cut = Number(btn.getAttribute("data-cut")) || 25;
      $("ctPer").value = per;
      $("ctCut").value = cut;
      state.rule.per = per;
      state.rule.cut = cut;
      save();
      document.querySelectorAll(".ct-preset").forEach(function (x) { x.classList.remove("active"); });
      btn.classList.add("active");
      renderRecommend();
      toast("已切换：每满 " + per + " 减 " + cut + "（以会场实际规则为准）");
    });
  });

  function renderAll() { renderRows(); renderRecommend(); }

  /* ---------- 启动 ---------- */
  load();
  $("ctPer").value = state.rule.per;
  $("ctCut").value = state.rule.cut;
  syncPresets();
  renderAll();
})();
