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
    : "https://yangmao-aihub.370542303.workers.dev"; // Cloudflare Worker（2026-10-16 已部署）

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
    var bar = null;
    function ensureBar() {
      if (bar) return bar;
      bar = document.getElementById("apiBanner");
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "apiBanner";
        bar.setAttribute("role", "status");
        bar.style.cssText = "display:none;position:sticky;top:0;z-index:80;margin:0;padding:10px 16px;" +
          "font:13px/1.6 system-ui,-apple-system,sans-serif;text-align:center;" +
          "background:#fff7ed;color:#9a3412;border-bottom:1px solid #fdba74";
        document.body.insertBefore(bar, document.body.firstChild);
      }
      return bar;
    }
    function show(msg, withBtn) {
      var b = ensureBar();
      b.innerHTML = "";
      b.appendChild(document.createTextNode(msg + " "));
      if (withBtn) {
        var btn = document.createElement("b");
        btn.textContent = "点这里刷新 →";
        btn.style.cssText = "cursor:pointer;text-decoration:underline";
        btn.onclick = function () { location.reload(true); };
        b.appendChild(btn);
      }
      b.style.display = "block";
    }
    function hide() { if (bar) bar.style.display = "none"; }
    function fail() {
      show("⚠ 数据服务连接失败，商品和线报暂时显示不了。" +
        (isLocal
          ? "本地请先启动 API（node tools/dev-api.mjs，端口 8790）再访问 http://127.0.0.1:8080。"
          : "可能是网络波动，刷新一下就好；多次刷新不行的话，检查下网络或代理设置。"), true);
    }
    function run() {
      if (!document.body) { document.addEventListener("DOMContentLoaded", run); return; }
      var tries = 0;
      (function attempt() {
        apiGet("/api/health").then(function (h) {
          if (h && h.ok) hide();
          else if (++tries < 3) setTimeout(attempt, 1500);
          else fail();
        }).catch(function () {
          if (++tries < 3) setTimeout(attempt, 1500);
          else fail();
        });
      })();
    }
    run();
  }

  /* ================= 独立页侧栏（可隐藏） =================
   * 所有 .page-wrap 布局的独立页（chat/tipoff/coutao/xhd/coin/collection/
   * wechat/about/skill）注入与首页一致的左侧栏 + ☰ 隐藏按钮。
   * index.html（.layout）自带侧栏，不受影响。 */
  var SIDE_LINKS = [
    { group: "对话", items: [
      { href: "chat.html", label: "AI 找券对话", key: "chat",
        icon: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' },
      { href: "coin.html", label: "淘金币互助", key: "coin",
        icon: '<circle cx="12" cy="12" r="10"/><path d="M8.5 9.5c.5-1.2 1.9-2 3.5-2 2 0 3.5 1 3.5 2.4 0 1.3-1 2-3 2.4-2.2.4-3 1.2-3 2.5 0 1.4 1.5 2.4 3.5 2.4 1.6 0 3-.8 3.5-2"/><path d="M12 5.5v13"/>' }
    ] },
    { group: "红包专区", items: [
      { href: "index.html#redpacket", label: "双11 红包入口", key: "rp",
        icon: '<path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>' },
      { href: "index.html#activities", label: "活动会场", key: "act",
        icon: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>' }
    ] },
    { group: "工具箱", items: [
      { href: "tipoff.html", label: "实时线报广场", key: "tipoff",
        icon: '<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>' },
      { href: "coutao.html", label: "凑单工具", key: "coutao",
        icon: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="10" y2="18"/><line x1="14" y1="18" x2="16" y2="18"/>' },
      { href: "xhd.html", label: "消灭小红包", key: "xhd",
        icon: '<path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>' },
      { href: "index.html#calendar", label: "双11 日历", key: "cal",
        icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' }
    ] },
    { group: "榜单", items: [
      { href: "index.html#seckill", label: "今日秒杀", key: "sk",
        icon: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>' },
      { href: "index.html#feed", label: "好价榜", key: "feed",
        icon: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>' }
    ] },
    { group: "聚合", items: [
      { href: "collection.html", label: "羊毛集合", key: "coll",
        icon: '<path d="M3 7v10a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 17V7a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 7z"/><path d="M21 8l-9 4-9-4"/><path d="M3 12l9 4 9-4"/>' }
    ] }
  ];

  function buildPageSidebar() {
    if (document.querySelector(".layout")) return; // 首页（自带侧栏）不注入

    var here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    document.body.classList.add("has-page-side");

    var html = '<aside class="page-sidebar" id="pageSidebar">' +
      '<a class="brand" href="index.html">' + LOGO_SVG +
      '<span class="brand-name">羊毛AIHUB<small>AI · 省钱作业君</small></span></a>';
    for (var g = 0; g < SIDE_LINKS.length; g++) {
      var grp = SIDE_LINKS[g];
      html += '<div class="nav-group"><div class="nav-label">' + grp.group + '</div><nav class="side-nav">';
      for (var i = 0; i < grp.items.length; i++) {
        var it = grp.items[i];
        var target = it.href.split("#")[0];
        var active = target === here ? " active" : "";
        html += '<a href="' + it.href + '" class="' + active.trim() + '">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + it.icon + '</svg>' +
          it.label + '</a>';
      }
      html += '</nav></div>';
    }
    html += '<div class="side-foot">' +
      '<div class="side-row">' +
        '<a class="side-chip" href="https://github.com/Chenking-maker/yangmao-aihub" target="_blank" rel="noopener"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.18-1.49 3.14-1.18 3.14-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.41-2.69 5.38-5.25 5.66.41.36.78 1.05.78 2.12v3.15c0 .31.21.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/></svg>GitHub</a>' +
        '<a class="side-chip" href="wechat.html"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 4C4.36 4 1 6.91 1 10.5c0 1.95 1.05 3.69 2.73 4.86L3 18.5l3.2-1.6c.74.2 1.52.31 2.3.31.27 0 .53-.01.79-.04A5.5 5.5 0 0 1 9 15.5C9 11.91 12.36 9 16.5 9c.3 0 .6.01.89.04C16.78 6.08 13 4 8.5 4zm-2.2 3.2a.95.95 0 1 1 0 1.9.95.95 0 0 1 0-1.9zm4.4 0a.95.95 0 1 1 0 1.9.95.95 0 0 1 0-1.9zM16.5 10.5c-3.31 0-6 2.24-6 5s2.69 5 6 5c.67 0 1.32-.09 1.93-.26L22 21.5l-.6-2.4c1.6-1.1 2.6-2.74 2.6-4.6 0-2.76-2.69-5-6-5zm-2 3.3a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6zm4 0a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6z"/></svg>微信群</a>' +
      '</div>' +
      '<a class="side-chip" href="skill.html">⚡ 羊毛AIHUB · Skill</a>' +
      '<a class="side-chip" href="about.html">羊毛AIHUB介绍</a>' +
      '</div></aside>';

    /* 侧栏开关：方向箭头图标（展开=◀ 指向侧栏，点击收起；收起=▶ 点击展开）。
     * 位置固定在侧栏顶部 logo 行右侧 / 收起时在左上角，均不遮挡顶栏与 logo。 */
    var CHEV_L = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
    var CHEV_R = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
    var toggle = '<button class="side-toggle" id="sideToggle" title="隐藏侧栏（快捷键 [）" aria-label="切换侧栏">' + CHEV_L + '</button>' +
      '<div class="side-scrim" id="sideScrim"></div>';

    document.body.insertAdjacentHTML("afterbegin", toggle + html);

    /* 把主内容（topnav/侧栏/按钮/script/toast 之外的所有节点）包进
     * .page-main-wrap，统一加左边距，免去逐个页面改结构 */
    var keep = /(^|\s)(topnav|page-sidebar|toast|side-toggle|side-scrim)(\s|$)/;
    var nodes = [];
    for (var i = 0; i < document.body.childNodes.length; i++) {
      var n = document.body.childNodes[i];
      if (n.nodeType === 1) {
        if (n.tagName === "SCRIPT" || n.tagName === "TEMPLATE" || keep.test(n.className || "")) continue;
        nodes.push(n);
      } else if (n.nodeType === 3 && !(n.textContent || "").trim()) {
        continue;
      }
    }
    if (nodes.length) {
      var wrapEl = document.createElement("div");
      wrapEl.className = "page-main-wrap";
      document.body.insertBefore(wrapEl, nodes[0]);
      for (var j = 0; j < nodes.length; j++) wrapEl.appendChild(nodes[j]);
    }

    var body = document.body, btn = $("sideToggle"), scrim = $("sideScrim");
    var isNarrow = window.matchMedia("(max-width: 900px)").matches;
    if (isNarrow) body.classList.add("ps-closed"); // 窄屏默认收起
    function setSide(open) {
      body.classList.toggle("ps-closed", !open);
      btn.innerHTML = open ? CHEV_L : CHEV_R;
      btn.setAttribute("title", open ? "隐藏侧栏（快捷键 [）" : "显示侧栏（快捷键 [）");
    }
    btn.addEventListener("click", function () { setSide(body.classList.contains("ps-closed")); });
    if (scrim) scrim.addEventListener("click", function () { body.classList.add("ps-closed"); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "[" || e.key === "【") { setSide(body.classList.contains("ps-closed")); }
    });
  }

  global.WOOL = {
    $: $, API_BASE: API_BASE, apiGet: apiGet, apiPost: apiPost,
    toast: toast, copyText: copyText, esc: esc, LOGO_SVG: LOGO_SVG,
    buildTopnav: buildTopnav, buildPageSidebar: buildPageSidebar,
    openActivity: openActivity,
    openTbRedpacket: openTbRedpacket, openJdRedpacket: openJdRedpacket,
    findActivity: findActivity,
    fmtSales: fmtSales, saveOf: saveOf, picUrl: picUrl,
    productCard: productCard, openCoupon: openCoupon, copyTaoword: copyTaoword,
    mountApiBanner: mountApiBanner
  };

  mountApiBanner();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildPageSidebar);
  } else { buildPageSidebar(); }
})(window);
