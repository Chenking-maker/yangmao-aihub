/* 羊毛AIHUB 首页逻辑 v2.3
 * 依赖 common.js（WOOL.*）与 chat-core.js（共享对话核心）
 * 本文件只管首页：顶栏/Logo / 紧凑对话挂载 / 淘金币互动 / 倒计时 /
 * 好价榜 / 今日秒杀 / 活动会场 / 双11 日历 / 侧栏高亮
 * 前端统一用「优惠」表述，不出现"返利"；数据来源统一称「AI 智能选品」
 */
(function () {
  "use strict";

  var W = window.WOOL;
  var $ = W.$;
  var productCard = W.productCard;

  // 顶栏导航 + Logo
  W.buildTopnav("home");
  var sideLogo = $("sideLogo"); if (sideLogo) sideLogo.innerHTML = W.LOGO_SVG;
  var heroMascot = $("heroMascot"); if (heroMascot) heroMascot.innerHTML = W.LOGO_SVG;

  // 首页紧凑对话（与 chat.html 共用同一核心）
  if ($("chatBody") && $("homeChatInput")) {
    W.mountChat({
      body: "chatBody",
      input: "homeChatInput",
      send: "homeChatSend",
      mode: "homeChatMode",
      chips: [
        "给爸妈买 200 元以内的纯牛奶",
        "9.9 包邮有什么值得买",
        "双11 超级红包怎么领",
        "满200减20怎么凑单"
      ]
    });
  }

  var API_BASE = W.API_BASE;
  function apiGet(p) { return fetch(API_BASE + p).then(function (r) { return r.json(); }); }
  function toast(msg) { W.toast(msg); }

  var state = { hasKey: false, llmReady: false, feedCache: {}, activities: [] };

  /* ---------- 我的省钱日报（本地记录，增强粘性） ---------- */
  (function mountDailyBand() {
    var host = $("dailyBand");
    if (!host || !W.saveStats) return;
    function paint() {
      var s = W.saveStats();
      var starN = W.starCount();
      host.innerHTML =
        '<div class="db-card">' +
          '<span class="db-ico">📊</span>' +
          '<span class="db-body">' +
            '<span class="db-t">我的省钱日报</span>' +
            '<span class="db-s">今天已省 <b>¥' + (Math.round(s.today.save * 10) / 10) + '</b>' +
              '　·　累计 ¥' + (Math.round(s.total * 10) / 10) +
              '　·　星标宝贝 <b>' + starN + '</b> 件' +
              (s.yesterday.count ? '　·　昨天省 ¥' + (Math.round(s.yesterday.save * 10) / 10) : '') +
            '</span>' +
          '</span>' +
          '<a class="db-btn" href="daily.html">看日报 ›</a>' +
          '<a class="db-btn ghost" href="star.html">⭐ 我的星标宝贝</a>' +
        '</div>';
    }
    paint();
    window.addEventListener("wool:star", paint);
  })();

  /* ---------- 双11 倒计时 ---------- */
  var EVENTS = [
    { name: "付尾款", at: new Date("2026-11-01T00:00:00+08:00") },
    { name: "高潮期开启", at: new Date("2026-11-10T20:00:00+08:00") },
    { name: "返场结束", at: new Date("2026-11-13T23:59:59+08:00") }
  ];
  function pad(n) { return String(n).padStart(2, "0"); }
  function nextEvent() {
    var now = Date.now();
    for (var i = 0; i < EVENTS.length; i++) if (EVENTS[i].at.getTime() > now) return EVENTS[i];
    return null;
  }
  function tick() {
    var ev = nextEvent();
    var heroCd = $("heroCd"), heroName = $("heroCdName"), bandCd = $("bandCd");
    if (!ev) {
      heroCd.textContent = "双11 已结束";
      heroName.textContent = "感谢参与 · 明年再见";
      bandCd.textContent = "双11 已结束";
      return;
    }
    var diff = Math.floor((ev.at.getTime() - Date.now()) / 1000);
    var d = Math.floor(diff / 86400), h = Math.floor(diff / 3600) % 24,
        m = Math.floor(diff / 60) % 60, s = diff % 60;
    var txt = d + " 天 " + pad(h) + " 时 " + pad(m) + " 分 " + pad(s) + " 秒";
    heroCd.textContent = txt;
    heroName.textContent = ev.name + " · " + ev.at.getFullYear() + "-" + pad(ev.at.getMonth() + 1) + "-" + pad(ev.at.getDate()) +
      " " + pad(ev.at.getHours()) + ":" + pad(ev.at.getMinutes());
    bandCd.textContent = "距" + ev.name + " " + d + " 天 " + pad(h) + " 时";
  }
  tick();
  setInterval(tick, 1000);

  /* ---------- 榜单加载 ---------- */
  function renderCards(list, container) {
    container.innerHTML = "";
    if (!list.length) { container.innerHTML = '<div class="empty-note">暂无数据，换个关键词试试 ›</div>'; return; }
    list.forEach(function (p) { container.appendChild(productCard(p)); });
  }

  function loadFeed(type, container, demoTag) {
    if (state.feedCache[type]) { renderCards(state.feedCache[type], container); return; }
    container.innerHTML = '<div class="empty-note">正在抓取好价…</div>';
    apiGet("/api/feed?type=" + type).then(function (list) {
      if (Array.isArray(list) && list.length) {
        state.feedCache[type] = list; renderCards(list, container);
      } else { throw new Error("empty"); }
    }).catch(function () {
      renderCards(window.PRODUCTS.filter(function (p) { return p.tag === demoTag; }), container);
    });
  }
  loadFeed(2, $("feedGrid"), "9.9");
  $("feedTabs").addEventListener("click", function (e) {
    var tab = e.target.closest(".tab"); if (!tab) return;
    this.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
    tab.classList.add("active");
    loadFeed(Number(tab.getAttribute("data-type")), $("feedGrid"), "9.9");
  });

  /* ---------- 今日秒杀 ---------- */
  function skItem(p) {
    var el = document.createElement("div");
    el.className = "sk-item";
    var imgInner = p.pic
      ? '<img src="' + W.picUrl(p) + '" data-direct="' + p.pic + '" referrerpolicy="no-referrer" alt="">'
      : (p.icon || "图");
    el.innerHTML =
      '<div class="sk-img">' + imgInner + '</div>' +
      '<div class="sk-info">' +
        '<div class="sk-title">' + W.esc(p.title) + '</div>' +
        '<div class="sk-meta">' + W.esc(p.shop || "品质店铺") + ' · 已售 ' + W.fmtSales(p.sales || 0) + '</div>' +
        '<div class="sk-price">' +
          '<span class="now">' + p.endPrice + '</span>' +
          '<span class="old">¥' + p.price + '</span>' +
          (Number(p.coupon) > 0 ? '<span class="coupon">券 ¥' + p.coupon + '</span>' : "") +
        '</div>' +
      '</div>';
    el.appendChild(W.starBtn(W.starItemOfProduct(p)));
    el.addEventListener("click", function (e) {
      if (e.target.closest(".star-btn")) return;   // 点星星不算点卡片
      W.openCoupon(p);
    });
    var img = el.querySelector(".sk-img img");
    if (img) {
      var retried = false;
      img.addEventListener("error", function () {
        var direct = img.getAttribute("data-direct");
        if (!retried && direct) { retried = true; img.removeAttribute("referrerpolicy"); img.src = direct; }
        else { img.remove(); el.querySelector(".sk-img").textContent = p.icon || "图"; }
      });
    }
    return el;
  }
  function loadSeckill() {
    var box = $("skList");
    if (state.feedCache[6]) { state.feedCache[6].slice(0, 6).forEach(function (p) { box.appendChild(skItem(p)); }); return; }
    box.innerHTML = '<div class="empty-note">正在抓取秒杀好物…</div>';
    apiGet("/api/feed?type=6").then(function (list) {
      state.feedCache[6] = list;
      box.innerHTML = "";
      var items = (Array.isArray(list) ? list : []).slice(0, 6);
      if (items.length < 4) {
        apiGet("/api/feed?type=2").then(function (list2) {
          var seen = {}; items.forEach(function (p) { seen[p.id] = 1; });
          (list2 || []).forEach(function (p) {
            if (items.length >= 6) return;
            if (!seen[p.id]) { seen[p.id] = 1; items.push(p); }
          });
          items.forEach(function (p) { box.appendChild(skItem(p)); });
        }).catch(function () { items.forEach(function (p) { box.appendChild(skItem(p)); }); });
      } else { items.forEach(function (p) { box.appendChild(skItem(p)); }); }
    }).catch(function () {
      box.innerHTML = "";
      window.PRODUCTS.filter(function (p) { return p.tag === "seckill"; }).slice(0, 4)
        .forEach(function (p) { box.appendChild(skItem(p)); });
    });
  }
  loadSeckill();

  /* ---------- 红包 / 活动会场 ---------- */
  function findActivity(kw) {
    for (var i = 0; i < state.activities.length; i++) if (state.activities[i].name.indexOf(kw) > -1) return state.activities[i];
    return null;
  }
  function openRedpacket(a) { W.openActivity(a); }
  function renderActivities() {
    var grid = $("actGrid");
    var list = state.activities.length ? state.activities : window.ACTIVITIES.map(function (a) {
      return { name: a.name, platform: a.platform, period: a.time, url: "", hot: a.hot };
    });
    grid.innerHTML = "";
    list.slice(0, 12).forEach(function (a) {
      var hot = a.hot || a.name.indexOf("红包") > -1 || a.name.indexOf("主会场") > -1;
      var el = document.createElement("div");
      el.className = "act-card" + (hot ? " hot" : "");
      el.innerHTML =
        '<div class="act-top"><span class="act-platform">' + W.esc(a.platform) + '</span><span class="act-name">' + W.esc(a.name) + '</span></div>' +
        '<div class="act-time">' + W.esc(a.period || "") +
          (a.rebate ? ' <span class="rebate-dot">专属优惠</span>' : (a.needAuth ? ' <span class="rebate-dot soon">未配返利</span>' : '')) + '</div>' +
        '<button class="act-btn">进入会场 ›</button>';
      el.querySelector(".act-top").appendChild(W.starBtn({
        k: "a:" + (a.activityId || a.id || a.name), type: "activity", title: a.name,
        platform: a.platform, activityId: a.activityId || "", url: a.url || "",
        direct: a.direct || "", channel: a.channel || "", save: 0
      }));
      el.querySelector(".act-btn").addEventListener("click", function () {
        openRedpacket(state.activities.length ? findActivity(a.name) : a);
      });
      grid.appendChild(el);
    });
  }
  apiGet("/api/activities").then(function (list) {
    if (Array.isArray(list) && list.length) {
      state.activities = list; renderActivities();
      var tb = findActivity("超级红包") || findActivity("红包");
      var jd = findActivity("京享红包") || findActivity("京东");
      $("rpTbBtn").addEventListener("click", function () { openRedpacket(tb); });
      $("rpJdBtn").addEventListener("click", function () { openRedpacket(jd); });
      if (tb) document.querySelector("#redpacket .rp-name").textContent = "淘宝 · " + tb.name;
    }
  }).catch(function () {
    renderActivities();
    $("rpTbBtn").addEventListener("click", function () { toast("打开淘宝 APP 搜索「超级红包」即可领取"); });
    $("rpJdBtn").addEventListener("click", function () { toast("打开京东 APP 搜索「京享红包」即可领取"); });
  });

  /* ---------- 双11 日历 ---------- */
  var tl = $("timeline");
  window.CALENDAR.forEach(function (c) {
    var node = document.createElement("div");
    node.className = "tl-node" + (c.state ? " " + c.state : "");
    node.innerHTML =
      '<span class="tl-date">' + W.esc(c.date) + '</span>' +
      '<div class="tl-body"><h4><span class="tl-dot"></span>' + W.esc(c.name) + '</h4><p>' + W.esc(c.desc) + '</p></div>';
    tl.appendChild(node);
  });

  /* ---------- 侧栏高亮 ---------- */
  var navLinks = document.querySelectorAll(".side-nav a[data-sec]");
  var secs = ["redpacket", "activities", "toolbox", "seckill", "feed"].map(function (id) { return $(id); });
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) {
        var id = en.target.id;
        navLinks.forEach(function (a) { a.classList.toggle("active", a.getAttribute("data-sec") === id); });
      }
    });
  }, { rootMargin: "-20% 0px -70% 0px" });
  secs.forEach(function (s) { if (s) observer.observe(s); });

  /* ---------- 健康检查 ---------- */
  apiGet("/api/health").then(function (h) {
    if (h && h.ok) {
      state.hasKey = !!h.hasKey; state.llmReady = !!h.hasLLM;
    }
  }).catch(function () { /* 顶部已有连通性提示条 */ });
})();
