/* 羊毛AIHUB · 跨页面共享逻辑
 * 提供：API 配置、Toast、顶部导航（超级红包/AI找券/首页/线报广场/羊毛集合）、
 *       商品卡与领券（首页/线报/凑单/消灭小红包共用）、红包打开、服务连通性提示
 * 所有页面先引入本文件，再引入各自的业务脚本。优惠字段从前端可见，佣金字段从不经前端。
 */
(function (global) {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var isLocal = location.hostname === "127.0.0.1" || location.hostname === "localhost";
  var API_BASE = isLocal
    ? "http://127.0.0.1:8790"
    : "https://wool-ai-api.workers.dev"; // TODO: Worker 部署后替换为真实域名

  function apiGet(p) { return fetch(API_BASE + p).then(function (r) { return r.json(); }); }
  function apiPost(p, b) {
    return fetch(API_BASE + p, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(b || {})
    }).then(function (r) { return r.json(); });
  }

  /* Logo：小羊 + 掉钱 + 带电 AI 徽章（寓意：装了 AI 的羊毛，更省钱更赚钱） */
  var LOGO_SVG =
    '<svg class="logo-svg" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<rect width="40" height="40" rx="10" fill="#d93832"/>' +
    '<g fill="#ffffff">' +
    '<circle cx="17" cy="20" r="6.5"/><circle cx="24" cy="18" r="6"/>' +
    '<circle cx="23" cy="25" r="5.5"/><circle cx="16" cy="26" r="5"/>' +
    '</g>' +
    '<ellipse cx="20" cy="25" rx="5" ry="4.6" fill="#ffffff"/>' +
    '<circle cx="18.4" cy="24.3" r="0.9" fill="#222"/><circle cx="21.6" cy="24.3" r="0.9" fill="#222"/>' +
    '<path d="M16 21 q-2.6 -1 -2.7 -3.7 q2.6 0.8 3.7 2.9z" fill="#eef0f3"/>' +
    '<path d="M24 21 q2.6 -1 2.7 -3.7 q-2.6 0.8 -3.7 2.9z" fill="#eef0f3"/>' +
    '<g><circle cx="33.5" cy="12" r="4.6" fill="#f6c544" stroke="#e0a800" stroke-width="0.8"/>' +
    '<text x="33.5" y="14.6" font-size="6" font-weight="700" fill="#9a6a00" text-anchor="middle">¥</text></g>' +
    '<rect x="4.5" y="4.5" width="13" height="8.6" rx="4" fill="#111827"/>' +
    '<text x="11" y="10.7" font-size="6" font-weight="700" fill="#5eead4" text-anchor="middle">AI</text>' +
    '<path d="M10.4 12.4 l-1.2 3.4 1.9 -0.7 -1 3.4" fill="none" stroke="#ffd23f" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/>' +
    '</svg>';

  var toastTimer = null;
  function toast(msg) {
    var t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2400);
  }
  function copyText(t, ok) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { toast(ok || "已复制"); });
    } else { toast("复制失败，请手动复制"); }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ================= 商品卡 / 领券（多页面共用） ================= */

  function fmtSales(n) { return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, "") + " 万" : String(n); }
  function saveOf(p) { return Math.max(0, (Number(p.price) || 0) - (Number(p.endPrice) || 0)).toFixed(1).replace(/\.0$/, ""); }
  function picUrl(p) {
    if (!p.pic) return "";
    return API_BASE + "/api/img?u=" + encodeURIComponent(p.pic);
  }

  function productCard(p) {
    var el = document.createElement("div");
    el.className = "pcard";
    var imgInner = p.pic
      ? '<img src="' + picUrl(p) + '" data-direct="' + p.pic + '" referrerpolicy="no-referrer" alt="">'
      : (p.icon || "图");
    var save = Number(p.coupon) > 0 ? "省 ¥" + p.coupon : "省 ¥" + saveOf(p);
    el.innerHTML =
      '<div class="pcard-top">' +
        '<div class="pcard-img">' + imgInner + '</div>' +
        '<div style="min-width:0;flex:1">' +
          '<div class="pcard-title">' + esc(p.title) + '</div>' +
          '<div class="pcard-meta">' + esc(p.shop || "品质店铺") + ' · 已售 ' + fmtSales(p.sales || 0) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="pcard-price">' +
        '<span class="price-now">' + p.endPrice + '</span>' +
        '<span class="price-old">¥' + p.price + '</span>' +
        (Number(p.coupon) > 0 ? '<span class="badge-coupon">券 ¥' + p.coupon + '</span>' : "") +
        '<span class="save-text">' + save + '</span>' +
      '</div>' +
      '<div class="pcard-foot">' +
        '<button class="btn-coupon act-coupon">领券购买</button>' +
        '<button class="btn-copy act-copy">淘口令</button>' +
      '</div>';
    el.querySelector(".act-coupon").addEventListener("click", function () { openCoupon(p); });
    el.querySelector(".act-copy").addEventListener("click", function () { copyTaoword(p); });
    var img = el.querySelector(".pcard-img img");
    if (img) {
      var retried = false;
      img.addEventListener("error", function () {
        var direct = img.getAttribute("data-direct");
        if (!retried && direct) { retried = true; img.removeAttribute("referrerpolicy"); img.src = direct; }
        else { img.remove(); el.querySelector(".pcard-img").textContent = p.icon || "图"; }
      });
    }
    return el;
  }

  /* 领券 / 淘口令：统一走 /api/coupon（ratesurl 转链，带归因参数） */
  function openCoupon(p) {
    if (p.couponurl) { window.open(p.couponurl, "_blank", "noopener"); return; }
    if (p.taoword) { copyText(p.taoword, "淘口令已复制，打开淘宝自动识别"); return; }
    if (!p.id) { toast("演示数据，暂无可领链接"); return; }
    apiPost("/api/coupon", { itemid: p.id, title: p.title }).then(function (r) {
      if (r && r.data && (r.data.coupon_click_url || r.data.item_url)) {
        window.open(r.data.coupon_click_url || r.data.item_url, "_blank", "noopener");
      } else if (r && r.url) {
        window.open(r.url, "_blank", "noopener");
      } else { copyText(p.title, "已复制标题，去淘宝搜索即可领券"); }
    }).catch(function () { copyText(p.title, "已复制标题，去淘宝搜索即可领券"); });
  }
  function copyTaoword(p) {
    if (p.taoword) { copyText(p.taoword, "淘口令已复制，打开淘宝自动识别"); return; }
    if (!p.id) { toast("演示数据，暂无可复制口令"); return; }
    apiPost("/api/coupon", { itemid: p.id, title: p.title }).then(function (r) {
      var d = r && r.data ? r.data : {};
      if (d.taoword) copyText(d.taoword, "淘口令已复制，打开淘宝自动识别");
      else if (d.coupon_click_url) copyText(d.coupon_click_url, "领券链接已复制");
      else if (r && r.url) copyText(r.url, "领券链接已复制");
      else copyText(p.title, "口令生成中，已复制标题先去淘宝搜索");
    }).catch(function () { copyText(p.title, "口令生成中，已复制标题先去淘宝搜索"); });
  }

  /* ================= 顶部导航 ================= */
  function buildTopnav(active) {
    var nav = $("topnav");
    if (!nav) return;
    nav.innerHTML =
      '<a class="nav-brand" href="index.html">' + LOGO_SVG + '<span>羊毛AIHUB</span></a>' +
      '<nav class="nav-links">' +
        '<a class="rp-mini" id="rpMini" title="领取淘宝双11超级红包">🧧 超级红包</a>' +
        '<a href="index.html" class="' + (active === "home" ? "active" : "") + '">首页</a>' +
        '<a href="chat.html" class="' + (active === "chat" ? "active" : "") + '">AI 找券</a>' +
        '<a href="tipoff.html" class="' + (active === "tipoff" ? "active" : "") + '">线报广场</a>' +
        '<a href="collection.html" class="' + (active === "coll" ? "active" : "") + '">羊毛集合</a>' +
      '</nav>';
    var rmp = $("rpMini");
    if (rmp) rmp.addEventListener("click", function () { openTbRedpacket(); });
  }

  /* ================= 红包 / 会场 ================= */
  function findActivity(list, kw) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].name.indexOf(kw) > -1) return list[i];
    }
    return null;
  }
  function openActivity(a) {
    if (!a) { toast("会场加载中，稍后再试"); return; }
    if (!a.url) { toast("打开「" + a.name + "」：进入 " + a.platform + " APP 搜索同名会场"); return; }
    if (a.platform === "淘宝") {
      toast("正在生成红包链接…");
      apiPost("/api/redpacket", { activityId: a.activityId, activityUrl: a.url, title: a.name })
        .then(function (r) { window.open((r && r.url) || a.url, "_blank", "noopener"); })
        .catch(function () { window.open(a.url, "_blank", "noopener"); });
    } else {
      window.open(a.url, "_blank", "noopener");
    }
  }
  function openTbRedpacket() {
    toast("正在打开淘宝超级红包…");
    apiGet("/api/activities").then(function (list) {
      if (Array.isArray(list) && list.length) {
        var a = findActivity(list, "超级红包") || findActivity(list, "红包");
        if (a) openActivity(a);
        else window.open("https://www.taobao.com", "_blank", "noopener");
      } else { toast("打开淘宝 APP 搜索「超级红包」即可领取"); }
    }).catch(function () { toast("打开淘宝 APP 搜索「超级红包」即可领取"); });
  }
  function openJdRedpacket() {
    apiGet("/api/activities").then(function (list) {
      if (Array.isArray(list) && list.length) {
        var a = findActivity(list, "京享红包") || findActivity(list, "京东");
        if (a) openActivity(a);
        else window.open("https://www.jd.com", "_blank", "noopener");
      } else { toast("打开京东 APP 搜索「京享红包」即可领取"); }
    });
  }

  /* ---- AI 选品服务连通性提示 ----
   * 连不上本地/线上 API 时，在页面顶部显示醒目提示，
   * 避免首页悄悄回退演示数据、线报页显示"网络开小差"造成困惑。 */
  function mountApiBanner() {
    function show() {
      var bar = document.getElementById("apiBanner");
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "apiBanner";
        bar.setAttribute("role", "status");
        bar.style.cssText = "display:block;position:sticky;top:0;z-index:80;margin:0;padding:9px 16px;" +
          "font:13px/1.55 system-ui,-apple-system,sans-serif;text-align:center;" +
          "background:#fff7ed;color:#9a3412;border-bottom:1px solid #fdba74";
        document.body.insertBefore(bar, document.body.firstChild);
      }
      bar.textContent = isLocal
        ? "⚠ AI 选品服务未连接：本地请先启动 API（node tools/dev-api.mjs，端口 8790），再访问 http://127.0.0.1:8080 —— 商品与线报才会显示真实数据。"
        : "⚠ 服务加载中，如长时间未恢复请刷新页面。";
      bar.style.display = "block";
    }
    function hide() {
      var bar = document.getElementById("apiBanner");
      if (bar) bar.style.display = "none";
    }
    function run() {
      if (!document.body) { document.addEventListener("DOMContentLoaded", run); return; }
      apiGet("/api/health").then(function (h) {
        if (h && h.ok) hide(); else show();
      }).catch(show);
    }
    run();
  }

  global.WOOL = {
    $: $, API_BASE: API_BASE, apiGet: apiGet, apiPost: apiPost,
    toast: toast, copyText: copyText, esc: esc, LOGO_SVG: LOGO_SVG,
    buildTopnav: buildTopnav, openActivity: openActivity,
    openTbRedpacket: openTbRedpacket, openJdRedpacket: openJdRedpacket,
    findActivity: findActivity,
    fmtSales: fmtSales, saveOf: saveOf, picUrl: picUrl,
    productCard: productCard, openCoupon: openCoupon, copyTaoword: copyTaoword,
    mountApiBanner: mountApiBanner
  };

  mountApiBanner();
})(window);
