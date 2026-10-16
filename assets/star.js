/* 羊毛AIHUB · 我的星标宝贝 v2.15
 * 数据全部来自浏览器本地（common.js 的 WOOL.star*），不登录、不上传。
 * 功能：分类筛选 / 勾选 / 一键统计一共能省多少 / 删除选中 / 清空 / 30 天自动过期
 *
 * v2.15 重点：星标「实时线报」时存的是这条线报的**完整快照**（全部文字行 + 图片 +
 * 每一行的商品链接）。线报广场是流动的，12 小时后就滚出去了、原帖再也找不回来 ——
 * 所以星标页里直接看到全文，每个商品行都能点「获取购买链接」当场转链打开，
 * 不用（也不该）再回线报广场去碰运气。
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
  function pfClass(pf) {
    if (pf === "京东") return "jd";
    if (pf === "飞猪") return "fz";
    if (pf === "淘宝" || pf === "天猫") return "tm";
    return "";
  }
  /* 星标页图片：统一走缩放图（两大图床支持 URL 缩放，比原图省 80%+ 流量），
   * 失败由调用方的 bindImgFallback 逐级降级到代理/原图 */
  function picUrl(u, px) {
    return W.imgThumb(u, px || 176);
  }
  /* 图片三级降级：缩放图 → 代理 → 原图 → 隐藏 */
  function bindImg(img, original) {
    W.bindImgFallback(img, original, null, "");
  }

  /* ---------- 转链并打开 ----------
   * 转链是异步的（几百毫秒到几秒），必须先把窗口同步开出来再填地址，
   * 否则浏览器会把 window.open 当弹窗拦掉，用户点了像没反应一样。 */
  function convertOpen(link, opts) {
    opts = opts || {};
    var fallback = String(link || "");
    if (!fallback) { W.toast("这条没有可打开的链接"); return; }

    var pre = null;
    try { pre = window.open("about:blank", "_blank"); } catch (e) { pre = null; }
    if (pre) {
      try {
        pre.document.write('<title>正在获取…</title><div style="font-family:-apple-system,\'PingFang SC\',sans-serif;padding:44px;text-align:center;color:#555;font-size:15px">正在获取你的专属优惠链接…</div>');
      } catch (e) { /* ignore */ }
    }
    function land(url) {
      if (pre && !pre.closed) { try { pre.opener = null; } catch (e) { /* ignore */ } pre.location.href = url; }
      else window.open(url, "_blank", "noopener");
    }
    function giveUp() { if (pre && !pre.closed) try { pre.close(); } catch (e) { /* ignore */ } }

    W.toast("正在获取你的专属链接…");
    W.apiPost("/api/convert", { text: fallback }).then(function (r) {
      var url = (r && r.url) || "";
      if (!url && /^https?:\/\//.test(fallback)) url = fallback;   // 转不了就打开原链接，保证点得开
      if (url) {
        W.logSave({ k: opts.k || "", title: opts.title || "", save: opts.save });
        if (opts.item) {   // 顺手把转好的链接缓存进星标，下次点就是秒开
          var list = W.starList();
          for (var i = 0; i < list.length; i++) if (list[i].k === opts.item.k) { list[i].url = url; break; }
          try { localStorage.setItem("ck_star_items", JSON.stringify(list)); } catch (e) { /* ignore */ }
        }
        land(url);
        W.toast(r && r.converted === false ? "已为你打开原链接（这条暂时转不了返利）" : "已打开你的专属优惠链接");
      } else if (r && r.taoCode) {
        giveUp();
        W.copyText(r.taoCode, "淘口令已复制，打开淘宝自动识别");
      } else {
        giveUp();
        W.toast((r && (r.note || r.error)) || "没取到链接，稍后再试");
      }
    }).catch(function () {
      giveUp();
      W.toast("网络开小差了，再试一次");
    });
  }

  /* ---------- 卡片公共交互：勾选 / 移除 ---------- */
  function bindCard(el, it) {
    el.querySelector("input").addEventListener("change", function (e) {
      if (e.target.checked) picked[it.k] = true; else delete picked[it.k];
      el.classList.toggle("pick", !!picked[it.k]);
      paintSel();
    });
    var drop = el.querySelector(".js-drop");
    if (drop) drop.addEventListener("click", function () {
      W.starRemove(it.k);
      delete picked[it.k];
      W.toast("已移出星标宝贝");
      render();
    });
  }

  /* ---------- 完整线报卡（实时线报） ---------- */
  function wireTextOf(it) {
    var out = ["【" + (it.platform || "线报") + (it.time ? " · " + it.time : "") + "】"];
    var lines = Array.isArray(it.lines) ? it.lines : [];
    if (lines.length) {
      lines.forEach(function (ln) {
        var t = String(ln.t || "");
        if (t) out.push(t);
        else if (ln.l) out.push(String(ln.l));
      });
    } else {
      out.push(String(it.title || ""));
    }
    return out.join("\n");
  }

  function wireCard(it) {
    var el = document.createElement("div");
    el.className = "star-card star-card-wire" + (picked[it.k] ? " pick" : "");
    el.setAttribute("data-k", it.k);

    var lines = Array.isArray(it.lines) ? it.lines : [];
    var legacy = !lines.length;      // v2.15 之前的旧收藏：只存了文字标题，没有商品链接
    var rows = "";
    lines.forEach(function (ln) {
      var t = String(ln.t || "");
      var l = String(ln.l || "");
      if (t) rows += '<div class="star-wline">' + W.esc(t) + "</div>";
      if (l) {
        rows += '<div class="star-wfoot"><button class="star-wbtn" data-t="' +
          W.esc(encodeURIComponent(l)) + '">🛒 获取购买链接</button></div>';
      }
    });

    var imgs = (it.images && it.images.length)
      ? '<div class="star-wimgs">' + it.images.map(function (u) {
          return '<img class="star-img" loading="lazy" decoding="async" width="78" height="78" ' +
            'src="' + picUrl(u, 176) + '" data-orig="' + W.esc(u) + '" referrerpolicy="no-referrer" alt="">';
        }).join("") + "</div>"
      : "";

    el.innerHTML =
      '<label class="star-pick"><input type="checkbox" ' + (picked[it.k] ? "checked" : "") + "></label>" +
      '<div class="star-body">' +
        '<div class="star-wtop">' +
          '<span class="wire-pf ' + pfClass(it.platform) + '">' + W.esc(it.platform || "线报") + "</span>" +
          (it.category ? '<span class="wire-cate">' + W.esc(it.category) + "</span>" : "") +
          (it.time ? '<span class="wire-time">' + W.esc(it.time) + "</span>" : "") +
        "</div>" +
        (legacy
          ? '<div class="star-wline">' + W.esc(it.title || "") + "</div>" +
            '<div class="star-wnote">这条是旧版收藏（当时只存了文字，没存商品链接）。点右侧「回线报广场」试着重找；新版收藏会把整条线报连商品链接一起完整存下来。</div>'
          : '<div class="star-wlines">' + rows + "</div>") +
        imgs +
        '<div class="star-meta">' +
          '<span class="star-type">📡 实时线报</span>' +
          '<span class="star-time">' + ago(it.ts) + " 收藏 · 还剩 " + daysLeft(it.ts) + " 天</span>" +
          (legacy ? "" : '<span class="star-time">' + lines.length + " 行 · 已存完整快照</span>") +
        "</div>" +
      "</div>" +
      '<div class="star-acts">' +
        (legacy ? '<button class="star-go js-square">回线报广场</button>' : "") +
        '<button class="star-drop js-copyall">复制全文</button>' +
        '<button class="star-drop js-drop">移除</button>' +
      "</div>";

    bindCard(el, it);

    var sq = el.querySelector(".js-square");
    if (sq) sq.addEventListener("click", function () {
      window.open("tipoff.html", "_blank", "noopener");
      W.toast("已打开线报广场，帮你找回这条线报");
    });

    el.querySelector(".js-copyall").addEventListener("click", function () {
      W.copyText(wireTextOf(it), "线报全文已复制");
    });

    el.querySelectorAll(".star-wbtn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var t = decodeURIComponent(btn.getAttribute("data-t") || "");
        var old = btn.textContent;
        btn.disabled = true;
        btn.textContent = "获取中…";
        setTimeout(function () { btn.disabled = false; btn.textContent = old; }, 5000);
        convertOpen(t, { k: it.k, title: it.title, save: it.save });
      });
    });

    return el;
  }

  /* ---------- 普通宝贝卡（好价商品 / 线报好物 / 红包会场 / 本地生活） ---------- */
  function starCard(it) {
    var el = document.createElement("div");
    el.className = "star-card" + (picked[it.k] ? " pick" : "");
    el.setAttribute("data-k", it.k);

    var pic = it.pic
      ? '<img class="star-img" loading="lazy" width="72" height="72" src="' + picUrl(it.pic, 160) +
        '" data-orig="' + W.esc(it.pic) + '" referrerpolicy="no-referrer" alt="">'
      : '<span class="star-ph">' + (TYPE_ICO[it.type] || "⭐") + "</span>";

    var priceRow = (Number(it.price) > 0 || Number(it.endPrice) > 0)
      ? '<div class="star-price">' +
          (it.endPrice ? '<span class="now">' + it.endPrice + "</span>" : "") +
          (Number(it.price) > 0 && String(it.price) !== String(it.endPrice) ? '<span class="old">' + it.price + "</span>" : "") +
          (it.save > 0 ? '<span class="save">省 ¥' + it.save + "</span>" : "") +
        "</div>"
      : "";

    var isWireish = (it.type === "wirelink");
    var full = strip(it.title);
    var head = isWireish && full.length > 60 ? full.slice(0, 60) : String(it.title || "").slice(0, 80);
    var tail = isWireish ? full.slice(60, 180) : "";
    var body = isWireish
      ? (tail ? '<div class="star-desc">' + W.esc(tail) + "</div>" : "")
      : (it.shop ? '<div class="star-shop">' + W.esc(it.shop) + "</div>" : "");

    var goLabel = it.type === "wirelink" ? "转链打开" : "打开";

    el.innerHTML =
      '<label class="star-pick"><input type="checkbox" ' + (picked[it.k] ? "checked" : "") + "></label>" +
      '<div class="star-thumb">' + pic + "</div>" +
      '<div class="star-body">' +
        '<div class="star-title">' + W.esc(head) + "</div>" +
        body + priceRow +
        '<div class="star-meta">' +
          '<span class="star-type">' + (TYPE_ICO[it.type] || "⭐") + " " + (TYPE_NAME[it.type] || "收藏") + "</span>" +
          '<span class="star-time">' + ago(it.ts) + " 收藏 · 还剩 " + daysLeft(it.ts) + " 天</span>" +
        "</div>" +
      "</div>" +
      '<div class="star-acts">' +
        '<button class="star-go">' + goLabel + "</button>" +
        '<button class="star-drop js-drop">移除</button>' +
      "</div>";

    bindCard(el, it);
    el.querySelector(".star-go").addEventListener("click", function () { openItem(it); });
    return el;
  }

  function openItem(it) {
    if (it.type === "product") {
      W.logSave({ k: it.k, title: it.title, save: it.save });
      if (it.url) { window.open(it.url, "_blank", "noopener"); return; }
      W.openCoupon({ id: it.itemId, title: it.title, couponurl: it.url, price: it.price, endPrice: it.endPrice, coupon: it.coupon });
      return;
    }
    if (it.type === "wirelink") { convertOpen(it.link, { k: it.k, title: it.title, save: it.save, item: it }); return; }
    if (it.type === "wire") {
      /* 新版星标存了完整快照，全文就在卡片上；只有旧数据才需要回线报广场 */
      if (Array.isArray(it.lines) && it.lines.length) {
        W.toast("这条线报的完整内容就在卡片里，点「获取购买链接」即可打开商品");
        return;
      }
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
      '<div class="sum-head">📊 这 ' + list.length + " 件宝贝的省钱账</div>" +
      '<div class="sum-grid">' +
        '<div class="sum-cell"><b>¥' + sumOld.toFixed(1) + "</b><span>全部原价</span></div>" +
        '<div class="sum-cell"><b>¥' + sumNew.toFixed(1) + "</b><span>券后总价</span></div>" +
        '<div class="sum-cell hi"><b>¥' + save.toFixed(1) + "</b><span>一共能省</span></div>" +
        '<div class="sum-cell"><b>' + off + "%</b><span>平均折扣</span></div>" +
      "</div>" +
      '<div class="sum-note">' +
        Object.keys(byType).map(function (t) { return (TYPE_NAME[t] || t) + " " + byType[t] + " 件"; }).join(" · ") +
        (priced.length < list.length ? "<br>（其中 " + (list.length - priced.length) + " 件是线报/会场，没有标价，未计入金额）" : "") +
      "</div>";
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
        "</div>";
      paintSel();
      return;
    }
    if (!list.length) {
      grid.innerHTML =
        '<div class="star-empty">' +
          '<div class="star-empty-ico">🗂️</div>' +
          '<div class="star-empty-t">这个分类下还没有收藏</div>' +
          '<div class="star-empty-s">点上面的「全部」看看其它宝贝。</div>' +
        "</div>";
      paintSel();
      return;
    }
    grid.innerHTML = "";
    list.forEach(function (it) {
      var card = it.type === "wire" ? wireCard(it) : starCard(it);
      grid.appendChild(card);
      /* 图片三级降级：缩放图失败 → 代理 → 原图 */
      card.querySelectorAll("img.star-img").forEach(function (img) {
        bindImg(img, img.getAttribute("data-orig") || "");
      });
    });
    paintSel();
  }

  window.addEventListener("wool:star", function () { render(); });
  render();
})();
