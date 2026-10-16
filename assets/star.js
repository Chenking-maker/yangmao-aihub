/* 羊毛AIHUB · 我的星标宝贝 v1.0
 * 数据全部来自浏览器本地（common.js 的 WOOL.star*），不登录、不上传。
 * 功能：列表 / 勾选 / 一键统计一共能省多少 / 删除选中 / 清空 / 30 天自动过期
 */
(function () {
  "use strict";
  var W = window.WOOL;
  var $ = W.$;
  W.buildTopnav("star");

  var grid = $("starGrid");
  var sumBox = $("starSum");
  var allChk = $("starAllChk");
  var selNote = $("starSelNote");
  var headCount = $("starHeadCount");
  var picked = {};   // k -> true

  var TYPE_NAME = { product: "好价商品", wire: "实时线报", wirelink: "线报好物", activity: "红包会场", life: "本地生活" };
  var TYPE_ICO = { product: "🛍️", wire: "📡", wirelink: "🔗", activity: "🧧", life: "🍜" };
  var FILTERS = [
    { k: "all", label: "全部" },
    { k: "product", label: "🛍️ 好价商品" },
    { k: "wirelink", label: "🔗 线报好物" },
    { k: "wire", label: "📡 实时线报" },
    { k: "activity", label: "🧧 红包会场" },
    { k: "life", label: "🍜 本地生活" }
  ];
  var filter = "all";

  function daysLeft(ts) {
    var left = 30 - Math.floor((Date.now() - (ts || 0)) / 86400000);
    if (left < 0) left = 0;
    return left;
  }
  function ago(ts) {
    var m = Math.floor((Date.now() - (ts || 0)) / 60000);
    if (m < 1) return "刚刚";
    if (m < 60) return m + " 分钟前";
    var h = Math.floor(m / 60);
    if (h < 24) return h + " 小时前";
    return Math.floor(h / 24) + " 天前";
  }
  function strip(s) {
    return String(s || "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  }

  /* ---------- 单个宝贝卡 ---------- */
  function starCard(it) {
    var el = document.createElement("div");
    el.className = "star-card" + (picked[it.k] ? " pick" : "");
    el.setAttribute("data-k", it.k);

    var pic = it.pic
      ? '<img loading="lazy" src="' + W.API_BASE + '/api/img?u=' + encodeURIComponent(it.pic) + '" referrerpolicy="no-referrer" alt="">'
      : '<span class="star-ph">' + (TYPE_ICO[it.type] || "⭐") + '</span>';

    var priceRow = (Number(it.price) > 0 || Number(it.endPrice) > 0)
      ? '<div class="star-price">' +
          (it.endPrice ? '<span class="now">¥' + it.endPrice + '</span>' : "") +
          (Number(it.price) > 0 && String(it.price) !== String(it.endPrice) ? '<span class="old">¥' + it.price + '</span>' : "") +
          (it.save > 0 ? '<span class="save">省 ¥' + it.save + '</span>' : "") +
        '</div>'
      : "";

    var isWireish = (it.type === "wire" || it.type === "wirelink");
    var full = strip(it.title);
    var head = isWireish ? full.slice(0, 56) : String(it.title || "").slice(0, 60);
    var tail = isWireish ? full.slice(56, 170) : "";
    var body = isWireish
      ? (tail ? '<div class="star-desc">' + W.esc(tail) + '</div>' : "")
      : (it.shop ? '<div class="star-shop">' + W.esc(it.shop) + '</div>' : "");

    /* 打开按钮文案要区分：好价商品/线报好物=可直接打开；整条线报=跳线报广场 */
    var goLabel = it.type === "wire" ? "去线报广场" : (it.type === "wirelink" ? "转链打开" : "打开");

    el.innerHTML =
      '<label class="star-pick"><input type="checkbox" ' + (picked[it.k] ? "checked" : "") + '></label>' +
      '<div class="star-thumb">' + pic + '</div>' +
      '<div class="star-body">' +
        '<div class="star-title">' + W.esc(head) + '</div>' +
        body + priceRow +
        '<div class="star-meta">' +
          '<span class="star-type">' + (TYPE_ICO[it.type] || "⭐") + " " + (TYPE_NAME[it.type] || "收藏") + '</span>' +
          '<span class="star-time">' + ago(it.ts) + ' 收藏 · 还剩 ' + daysLeft(it.ts) + ' 天</span>' +
        '</div>' +
      '</div>' +
      '<div class="star-acts">' +
        '<button class="star-go">' + goLabel + '</button>' +
        '<button class="star-drop">移除</button>' +
      '</div>';

    el.querySelector("input").addEventListener("change", function (e) {
      if (e.target.checked) picked[it.k] = true; else delete picked[it.k];
      el.classList.toggle("pick", !!picked[it.k]);
      paintSel();
    });
    el.querySelector(".star-go").addEventListener("click", function () { openItem(it); });
    el.querySelector(".star-drop").addEventListener("click", function () {
      W.starRemove(it.k);
      delete picked[it.k];
      W.toast("已移出星标宝贝");
      render();
    });
    return el;
  }

  /* 线报好物：先同步占位开窗（不然转链是异步的，浏览器会当弹窗拦掉），拿到链接再填进去 */
  function openWireLink(it) {
    var fallback = String(it.link || "");
    if (it.url) {
      W.logSave({ k: it.k, title: it.title, save: it.save });
      window.open(it.url, "_blank", "noopener");
      return;
    }
    if (!fallback) { W.toast("这条没有可打开的链接，去线报广场看看同款"); return; }

    var pre = null;
    try { pre = window.open("about:blank", "_blank"); } catch (e) { pre = null; }
    if (pre) {
      try { pre.document.write('<title>正在获取…</title><div style="font-family:-apple-system,\'PingFang SC\',sans-serif;padding:44px;text-align:center;color:#555;font-size:15px">正在获取你的专属优惠链接…</div>'); } catch (e) { /* ignore */ }
    }
    function land(url) {
      if (pre && !pre.closed) { try { pre.opener = null; } catch (e) { /* ignore */ } pre.location.href = url; }
      else window.open(url, "_blank", "noopener");
    }
    W.toast("正在获取你的专属链接…");
    W.apiPost("/api/convert", { text: fallback }).then(function (r) {
      var url = (r && r.url) || "";
      if (!url && /^https?:\/\//.test(fallback)) url = fallback;      // 转不了就打开原链接，保证点得开
      if (url) {
        W.logSave({ k: it.k, title: it.title, save: it.save });
        var list = W.starList();
        for (var i = 0; i < list.length; i++) {
          if (list[i].k === it.k) { list[i].url = url; break; }
        }
        try { localStorage.setItem("ck_star_items", JSON.stringify(list)); } catch (e) { /* ignore */ }
        land(url);
        W.toast(r && r.converted === false ? "已为你打开原链接（这条暂时转不了返利）" : "已打开你的专属优惠链接");
      } else if (r && r.taoCode) {
        if (pre && !pre.closed) try { pre.close(); } catch (e) { /* ignore */ }
        W.copyText(r.taoCode, "淘口令已复制，打开淘宝自动识别");
      } else {
        if (pre && !pre.closed) try { pre.close(); } catch (e) { /* ignore */ }
        W.toast((r && (r.note || r.error)) || "没取到链接，稍后再试");
      }
    }).catch(function () {
      if (pre && !pre.closed) try { pre.close(); } catch (e) { /* ignore */ }
      W.toast("网络开小差了，再试一次");
    });
  }

  function openItem(it) {
    if (it.type === "product") {
      W.logSave({ k: it.k, title: it.title, save: it.save });
      if (it.url) { window.open(it.url, "_blank", "noopener"); return; }
      W.openCoupon({ id: it.itemId, title: it.title, couponurl: it.url, price: it.price, endPrice: it.endPrice, coupon: it.coupon });
      return;
    }
    if (it.type === "wirelink") { openWireLink(it); return; }
    if (it.type === "wire") {
      /* 整条线报只是个备忘（一条线报可能含多个商品链接），打开去线报广场找同款 */
      window.open("tipoff.html", "_blank", "noopener");
      W.toast("已打开线报广场，帮你找回这条线报");
      return;
    }
    if (it.type === "activity") {
      W.openActivity({ name: it.title, activityId: it.activityId, url: it.url, direct: it.direct, channel: it.channel });
      return;
    }
    if (it.type === "life") {
      W.apiPost("/api/life/link", { id: it.lifeId }).then(function (r) {
        if (r && r.url) window.open(r.url, "_blank", "noopener");
        else W.toast((r && r.error) || "没取到链接，稍后再试");
      }).catch(function () { W.toast("网络开小差了，再试一次"); });
      return;
    }
    if (it.url) window.open(it.url, "_blank", "noopener");
    else W.toast("这条宝贝没有可打开的链接，去「实时线报广场」找找同款");
  }

  /* ---------- 勾选状态 ---------- */
  function pickedList() {
    return W.starList().filter(function (x) { return picked[x.k]; });
  }
  function paintSel() {
    var n = pickedList().length;
    selNote.textContent = "已选 " + n + " 件";
    var total = W.starList().length;
    allChk.checked = total > 0 && n === total;
    allChk.indeterminate = n > 0 && n < total;
  }

  /* ---------- 统计 ---------- */
  $("starSumBtn").addEventListener("click", function () {
    var list = pickedList();
    if (!list.length) { W.toast("先勾选几条宝贝再统计～"); return; }
    var priced = list.filter(function (x) { return Number(x.price) > 0 || Number(x.endPrice) > 0; });
    var sumOld = 0, sumNew = 0;
    priced.forEach(function (x) {
      sumOld += Number(x.price) || Number(x.endPrice) || 0;
      sumNew += Number(x.endPrice) || Number(x.price) || 0;
    });
    var save = Math.max(0, sumOld - sumNew);
    var off = sumOld > 0 ? Math.round((save / sumOld) * 1000) / 10 : 0;
    var byType = {};
    list.forEach(function (x) { byType[x.type] = (byType[x.type] || 0) + 1; });

    sumBox.hidden = false;
    sumBox.innerHTML =
      '<div class="sum-head">📊 这 ' + list.length + ' 件宝贝的省钱账</div>' +
      '<div class="sum-grid">' +
        '<div class="sum-cell"><b>¥' + sumOld.toFixed(1) + '</b><span>全部原价</span></div>' +
        '<div class="sum-cell"><b>¥' + sumNew.toFixed(1) + '</b><span>券后总价</span></div>' +
        '<div class="sum-cell hi"><b>¥' + save.toFixed(1) + '</b><span>一共能省</span></div>' +
        '<div class="sum-cell"><b>' + off + '%</b><span>平均折扣</span></div>' +
      '</div>' +
      '<div class="sum-note">' +
        Object.keys(byType).map(function (t) { return (TYPE_NAME[t] || t) + " " + byType[t] + " 件"; }).join(" · ") +
        (priced.length < list.length ? '<br>（其中 ' + (list.length - priced.length) + ' 件是线报/会场，没有标价，未计入金额）' : "") +
      '</div>';
    W.logSave({ k: "sum", title: "星标统计", save: save });
    sumBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  /* ---------- 删除 / 清空 / 全选 ---------- */
  $("starDelBtn").addEventListener("click", function () {
    var list = pickedList();
    if (!list.length) { W.toast("先勾选要删除的宝贝"); return; }
    if (!window.confirm("确定把这 " + list.length + " 件移出星标宝贝吗？")) return;
    W.starRemoveMany(list.map(function (x) { return x.k; }));
    picked = {};
    sumBox.hidden = true;
    W.toast("已删除 " + list.length + " 件");
    render();
  });
  $("starClearBtn").addEventListener("click", function () {
    if (!W.starList().length) { W.toast("星标宝贝是空的"); return; }
    if (!window.confirm("清空全部星标宝贝？此操作不可恢复。")) return;
    W.starClear(); picked = {}; sumBox.hidden = true; render();
    W.toast("已清空");
  });
  allChk.addEventListener("change", function () {
    if (allChk.checked) W.starList().forEach(function (x) { picked[x.k] = true; });
    else picked = {};
    render();
  });

  /* ---------- 分类筛选（实时线报 / 线报好物 / 好价商品 … 分开看） ---------- */
  var filterEl = $("starFilter");
  function renderFilters(list) {
    if (!filterEl) return;
    var counts = {};
    list.forEach(function (x) { counts[x.type] = (counts[x.type] || 0) + 1; });
    filterEl.innerHTML = "";
    FILTERS.forEach(function (f) {
      var n = f.k === "all" ? list.length : (counts[f.k] || 0);
      if (f.k !== "all" && !n) return;          // 没有的类型不占位
      var b = document.createElement("button");
      b.className = "star-filter-chip" + (filter === f.k ? " on" : "");
      b.textContent = f.label + " " + n;
      b.addEventListener("click", function () {
        if (filter === f.k) return;
        filter = f.k;
        render();
      });
      filterEl.appendChild(b);
    });
  }

  /* ---------- 渲染 ---------- */
  function render() {
    var all = W.starList();
    var list = filter === "all" ? all : all.filter(function (x) { return x.type === filter; });
    headCount.textContent = all.length + " 件";
    renderFilters(all);
    if (!all.length) {
      grid.innerHTML =
        '<div class="star-empty">' +
          '<div class="star-empty-ico">⭐</div>' +
          '<div class="star-empty-t">还没有星标宝贝</div>' +
          '<div class="star-empty-s">逛「实时线报广场」或首页「好价榜」时，点卡片右上角的星星，就能把看中的好价存到这里。</div>' +
          '<div class="star-empty-acts">' +
            '<a class="star-empty-btn" href="tipoff.html">去线报广场 ›</a>' +
            '<a class="star-empty-btn ghost" href="index.html#feed">去好价榜 ›</a>' +
          '</div>' +
        '</div>';
      paintSel();
      return;
    }
    if (!list.length) {
      grid.innerHTML =
        '<div class="star-empty">' +
          '<div class="star-empty-ico">🗂️</div>' +
          '<div class="star-empty-t">这个分类下还没有收藏</div>' +
          '<div class="star-empty-s">点上面的「全部」看看其它宝贝。</div>' +
        '</div>';
      paintSel();
      return;
    }
    grid.innerHTML = "";
    list.forEach(function (it) { grid.appendChild(starCard(it)); });
    paintSel();
  }

  window.addEventListener("wool:star", function () { render(); });
  render();
})();
