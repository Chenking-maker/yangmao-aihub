/* 羊毛AIHUB 首页逻辑 v2.1
 * 依赖 common.js（WOOL.*）：顶栏导航、主题、Logo、红包打开
 * 多轮对话：chatHistory 完整传给 /api/chat；AI 消息内嵌商品卡、红包卡、转链卡
 * 从未暴露任何佣金字样；前端统一用「优惠」表述，不出现"返利"；数据来源统一称「AI 智能选品」
 */
(function () {
  "use strict";

  var W = window.WOOL;
  var $ = W.$;

  // 顶栏导航 + Logo
  W.buildTopnav("home");
  var sideLogo = $("sideLogo"); if (sideLogo) sideLogo.innerHTML = W.LOGO_SVG;
  var heroMascot = $("heroMascot"); if (heroMascot) heroMascot.innerHTML = W.LOGO_SVG;

  var API_BASE = W.API_BASE;
  var state = { hasKey: false, llmReady: false, feedCache: {}, lastList: [], activities: [] };

  function apiGet(p) { return fetch(API_BASE + p).then(function (r) { return r.json(); }); }
  function apiPost(p, b) {
    return fetch(API_BASE + p, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(b || {})
    }).then(function (r) { return r.json(); });
  }

  function toast(msg) { W.toast(msg); }
  function copyText(t, ok) { W.copyText(t, ok); }
  function esc(s) { return W.esc(s); }

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

  /* ---------- 商品卡渲染（无佣金字段） ---------- */
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

  function renderCards(list, container) {
    container.innerHTML = "";
    if (!list.length) { container.innerHTML = '<div class="empty-note">暂无数据，换个关键词试试 ›</div>'; return; }
    list.forEach(function (p) { container.appendChild(productCard(p)); });
  }

  /* ---------- 领券 / 淘口令 ---------- */
  function openCoupon(p) {
    if (p.couponurl) { window.open(p.couponurl, "_blank", "noopener"); return; }
    if (p.taoword) { copyText(p.taoword, "淘口令已复制，打开淘宝自动识别"); return; }
    if (!p.id) { toast("演示数据，暂无可领链接"); return; }
    apiPost("/api/coupon", { itemid: p.id, title: p.title }).then(function (r) {
      if (r && r.data && (r.data.coupon_click_url || r.data.item_url)) {
        window.open(r.data.coupon_click_url || r.data.item_url, "_blank", "noopener");
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
      else copyText(p.title, "口令生成中，已复制标题先去淘宝搜索");
    }).catch(function () { copyText(p.title, "口令生成中，已复制标题先去淘宝搜索"); });
  }

  /* ---------- 榜单加载 ---------- */
  function loadFeed(type, container, demoTag) {
    if (state.feedCache[type]) { renderCards(state.feedCache[type], container); return; }
    container.innerHTML = '<div class="empty-note">正在抓取好价…</div>';
    apiGet("/api/feed?type=" + type).then(function (list) {
      if (Array.isArray(list) && list.length) {
        state.feedCache[type] = list; state.lastList = list; renderCards(list, container);
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
      ? '<img src="' + picUrl(p) + '" data-direct="' + p.pic + '" referrerpolicy="no-referrer" alt="">'
      : (p.icon || "图");
    el.innerHTML =
      '<div class="sk-img">' + imgInner + '</div>' +
      '<div class="sk-info">' +
        '<div class="sk-title">' + esc(p.title) + '</div>' +
        '<div class="sk-meta">' + esc(p.shop || "品质店铺") + ' · 已售 ' + fmtSales(p.sales || 0) + '</div>' +
        '<div class="sk-price">' +
          '<span class="now">' + p.endPrice + '</span>' +
          '<span class="old">¥' + p.price + '</span>' +
          (Number(p.coupon) > 0 ? '<span class="coupon">券 ¥' + p.coupon + '</span>' : "") +
        '</div>' +
      '</div>';
    el.addEventListener("click", function () { openCoupon(p); });
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
      state.feedCache[6] = list; state.lastList = list;
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
  function openRedpacket(a) {
    if (!a) { toast("会场加载中，稍后再试"); return; }
    if (!a.url) { toast("打开「" + a.name + "」：进入 " + a.platform + " APP 搜索同名会场"); return; }
    if (a.platform === "淘宝") {
      toast("正在生成红包链接…");
      apiPost("/api/redpacket", { activityId: a.activityId, activityUrl: a.url, title: a.name })
        .then(function (r) { window.open((r && r.url) || a.url, "_blank", "noopener"); })
        .catch(function () { window.open(a.url, "_blank", "noopener"); });
    } else { window.open(a.url, "_blank", "noopener"); }
  }
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
        '<div class="act-top"><span class="act-platform">' + esc(a.platform) + '</span><span class="act-name">' + esc(a.name) + '</span></div>' +
        '<div class="act-time">' + esc(a.period || "") + '</div>' +
        '<button class="act-btn">进入会场 ›</button>';
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

  /* ---------- AI 对话（多轮 + 转链卡） ---------- */
  var chatBody = $("chatBody"), chatInput = $("chatInput"), chatSend = $("chatSend");
  var chatHistory = [], chatBusy = false;

  var WELCOME_CHIPS = [
    "给爸妈买 200 元以内的纯牛奶",
    "9.9 包邮有什么值得买",
    "双11 超级红包怎么领",
    "满200减20怎么凑单",
    "聚划算今天有什么好价",
    "把淘宝链接转成我的优惠链接"
  ];
  function renderWelcome() {
    chatBody.innerHTML =
      '<div class="chat-welcome">' +
        '<div class="welcome-emoji">🐑</div>' +
        '<div class="big">想买什么，跟羊毛AI 说一声</div>' +
        '<div class="sub">帮你找隐藏优惠券、领双11 红包、算凑单；发淘宝/京东链接，还能直接转成你的优惠链接。全免费。</div>' +
        '<div class="welcome-chips">' +
          WELCOME_CHIPS.map(function (q) { return '<button class="wchip">' + esc(q) + '</button>'; }).join("") +
        '</div>' +
      '</div>';
    chatBody.querySelectorAll(".wchip").forEach(function (el) {
      el.addEventListener("click", function () { sendChat(el.textContent); });
    });
  }
  renderWelcome();

  function scrollChat() { chatBody.scrollTop = chatBody.scrollHeight; }
  function appendUserMsg(text) {
    if (chatBody.querySelector(".chat-welcome")) chatBody.innerHTML = "";
    var el = document.createElement("div");
    el.className = "msg msg-user";
    el.innerHTML = '<div class="msg-av">我</div><div class="bubble">' + esc(text) + '</div>';
    chatBody.appendChild(el); scrollChat();
  }

  function linkCardHtml(r) {
    var jd = r.platform === "京东";
    var status = r.converted
      ? '<span class="badge-coupon">已转好</span>'
      : '<span class="wire-note">' + esc(r.note || "暂未转链") + '</span>';
    var couponLine = (Number(r.coupon) > 0) ? '<div class="wire-note">这张券 ' + r.coupon + ' 元，下单一起抵现</div>' : '';
    var actions = r.url
      ? '<button class="rp-msg-btn" data-act="open">打开</button><button class="rp-msg-btn ghost" data-act="copy">复制</button>'
      : (r.taoCode ? '<button class="rp-msg-btn" data-act="tao">复制淘口令</button>' : '');
    var ico = jd ? "🎁" : "🧧";
    return '<div class="rp-msg-card' + (jd ? " jd" : "") + '">' +
      '<div class="rp-msg-ico">' + ico + '</div>' +
      '<div class="rp-msg-info">' +
        '<div class="rp-msg-name">' + (jd ? "京东" : "淘宝") + '链接 · 优惠通道</div>' +
        '<div class="rp-msg-url">' + esc(r.url || (r.taoCode ? "已生成淘口令" : "待转链")) + '</div>' +
      '</div>' +
      '<div class="rp-msg-actions">' + actions + '</div>' +
    '</div>' + status + couponLine;
  }

  function appendAiMsg(text, products, redpackets, links) {
    var el = document.createElement("div");
    el.className = "msg msg-ai";
    var cardsHtml = "";
    if (products && products.length) cardsHtml += '<div class="msg-cards" data-cards="products"></div>';
    if (links && links.length) {
      cardsHtml += '<div class="msg-cards">' + links.map(linkCardHtml).join("") + '</div>';
    }
    if (redpackets && redpackets.length) {
      cardsHtml += redpackets.map(function (r) {
        var jd = r.platform === "京东";
        return '<div class="msg-cards"><div class="rp-msg-card' + (jd ? " jd" : "") + '">' +
          '<div class="rp-msg-ico">' + (jd ? "🎁" : "🧧") + '</div>' +
          '<div class="rp-msg-info"><div class="rp-msg-name">' + esc(r.name) + ' · ' + esc(r.platform) + '</div>' +
          '<div class="rp-msg-url">' + esc(r.url) + '</div></div>' +
          '<div class="rp-msg-actions"><button class="rp-msg-btn" data-act="open">打开</button>' +
          '<button class="rp-msg-btn ghost" data-act="copy">复制</button></div>' +
        '</div></div>';
      }).join("");
    }
    el.innerHTML =
      '<div class="msg-av">🐑</div>' +
      '<div style="min-width:0;flex:1"><div class="bubble">' + formatReply(text) + '</div>' + cardsHtml + '</div>';
    chatBody.appendChild(el);

    if (products && products.length) {
      var wrap = el.querySelector('[data-cards="products"]');
      products.forEach(function (p) { wrap.appendChild(productCard(p)); });
    }
    el.querySelectorAll(".rp-msg-card").forEach(function (card, i) {
      var r = (links && links[i]) || (redpackets && redpackets[i]);
      card.querySelector('[data-act="open"]') && card.querySelector('[data-act="open"]').addEventListener("click", function () { if (r && r.url) window.open(r.url, "_blank", "noopener"); });
      card.querySelector('[data-act="copy"]') && card.querySelector('[data-act="copy"]').addEventListener("click", function () { copyText(r.url, "链接已复制"); });
      var taoBtn = card.querySelector('[data-act="tao"]');
      if (taoBtn) taoBtn.addEventListener("click", function () { copyText(r.taoCode, "淘口令已复制，打开淘宝自动识别"); });
    });
    scrollChat();
  }

  function formatReply(text) {
    var html = esc(text);
    html = html.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    html = html.replace(/^[-·]\s+/gm, "• ");
    html = html.replace(/\n/g, "<br>");
    return html;
  }
  function appendTyping() {
    var el = document.createElement("div");
    el.className = "msg msg-ai"; el.id = "typingMsg";
    el.innerHTML = '<div class="msg-av">🐑</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>';
    chatBody.appendChild(el); scrollChat();
  }
  function removeTyping() { var t = $("typingMsg"); if (t) t.remove(); }

  function sendChat(text) {
    text = (text || "").trim();
    if (!text || chatBusy) return;
    chatBusy = true; chatSend.disabled = true; chatInput.value = "";
    appendUserMsg(text);
    chatHistory.push({ role: "user", content: text });
    appendTyping();

    function done(reply, products, redpackets, links) {
      removeTyping();
      appendAiMsg(reply || "", products || [], redpackets || [], links || []);
      chatHistory.push({ role: "assistant", content: reply || "" });
      chatBusy = false; chatSend.disabled = false; chatInput.focus();
    }
    if (state.llmReady) {
      apiPost("/api/chat", { messages: chatHistory.slice(-8) }).then(function (r) {
        if (r && r.reply !== undefined) done(r.reply, r.products, r.redpackets, r.links);
        else searchModeReply(text, done);
      }).catch(function () { searchModeReply(text, done); });
    } else {
      searchModeReply(text, done);
    }
  }

  /* 无 LLM 时的降级：实时检索 */
  var STOP = ["我想", "想要", "想买", "购买", "帮忙", "帮我", "找一下", "找找", "查找", "搜索", "有没有", "有什么",
    "值得", "推荐", "一下", "想", "要", "给", "的", "吗", "呢", "吧", "多少钱", "以内", "以上", "左右",
    "怎么", "什么样", "哪种", "哪个", "哪些", "怎么挑", "划算", "便宜", "实惠", "性价比", "正品", "求推荐",
    "买", "爸妈", "父母", "老人", "孩子", "宝宝", "学生", "宿舍", "家用", "自己", "女朋友", "男朋友"];

  function extractKeywords(q) {
    var segs = q.split(/[，。,.!！?？\s]+/);
    var cands = [];
    segs.forEach(function (seg) {
      var s = seg;
      STOP.forEach(function (w) { s = s.split(w).join(""); });
      s = s.replace(/[0-9]+/g, "").replace(/[元块斤只盒包袋箱个条支杯瓶件套台部]/g, "");
      if (s.length >= 2) cands.push(s);
    });
    cands.sort(function (a, b) { return b.length - a.length; });
    return cands;
  }
  function searchModeReply(q, done) {
    var cands = extractKeywords(q);
    if (!cands.length) cands = [q];
    var idx = 0;
    function tryNext() {
      if (idx >= cands.length) { done("关键词「" + cands[0] + "」暂时没搜到带券商品，换个说法试试？比如直接说商品名。", demoFallback(q), [], []); return; }
      var kw = cands[idx++];
      apiGet("/api/search?q=" + encodeURIComponent(kw)).then(function (list) {
        if (Array.isArray(list) && list.length >= 3) {
          done("AI 实时选品 · 关键词「" + kw + "」 · 命中 " + list.length + " 款，挑了几款性价比高的：", list.slice(0, 3), [], []);
        } else tryNext();
      }).catch(function () { done("网络开小差了，先用演示数据顶一下：", demoFallback(q), [], []); });
    }
    tryNext();
  }
  function demoFallback(q) {
    var map = { 牛奶: "d001", 咖啡: "d008", 耳机: "d006", 牙刷: "d011", 抽纸: "d002", 湿巾: "d010", 巧克力: "d003", 板鞋: "d004", 羽绒: "d005", 吸尘器: "d009", 泡面: "d009", 精华: "d007", 袜: "d012" };
    for (var k in map) if (q.indexOf(k) > -1) return window.PRODUCTS.filter(function (p) { return p.id === map[k]; });
    return window.PRODUCTS.slice(0, 2);
  }

  chatSend.addEventListener("click", function () { sendChat(chatInput.value); });
  chatInput.addEventListener("keydown", function (e) { if (e.key === "Enter") sendChat(chatInput.value); });

  /* ---------- 凑单工具 ---------- */
  $("ctBtn").addEventListener("click", function () {
    var target = Number($("ctTarget").value) || 0;
    var current = Number($("ctCurrent").value) || 0;
    var gap = target - current;
    var result = $("ctResult"), hint = $("ctHint"), grid = $("ctGrid");
    result.style.display = "";
    if (target <= 0) { toast("先输入满减门槛"); return; }
    var save = Math.floor(target / 200) * 20; // 今年主流：每满200减20，上不封顶
    if (gap <= 0) {
      result.innerHTML = "已选金额已达门槛 ✔" + (save > 0 ? "，可享每满200减20，约省 <b>¥" + save + "</b>" : "");
      hint.textContent = ""; grid.innerHTML = ""; return;
    }
    result.innerHTML = "还差 <b>¥" + gap.toFixed(1).replace(/\.0$/, "") + "</b> 就能凑到「每满200减20」门槛" +
      (save > 0 ? "，预计再省 <b>¥" + save + "</b>" : "") + "，下面这些商品刚好补差";
    hint.textContent = "按券后价从高到低排序，凑完还剩的钱也标好了（减免以每满200减20估算，具体以店铺为准）";
    var pool = (state.lastList && state.lastList.length) ? state.lastList : window.PRODUCTS;
    var fits = pool.filter(function (p) { return Number(p.endPrice) <= gap; })
                   .sort(function (a, b) { return Number(b.endPrice) - Number(a.endPrice); }).slice(0, 6);
    grid.innerHTML = "";
    if (!fits.length) { grid.innerHTML = '<div class="empty-note">当前商品池没有合适的，先浏览好价榜再加购物车 ›</div>'; return; }
    fits.forEach(function (p) {
      var card = productCard(p);
      var left = gap - Number(p.endPrice);
      var badge = document.createElement("div");
      badge.className = "mono";
      badge.style.cssText = "font-size:11px;color:var(--text-2);margin-top:-4px";
      badge.textContent = left > 0 ? "凑上还差 ¥" + left.toFixed(1).replace(/\.0$/, "") : "刚好达标 ✔";
      card.appendChild(badge); grid.appendChild(card);
    });
  });

  /* ---------- 双11 日历 ---------- */
  var tl = $("timeline");
  window.CALENDAR.forEach(function (c) {
    var node = document.createElement("div");
    node.className = "tl-node" + (c.state ? " " + c.state : "");
    node.innerHTML =
      '<span class="tl-date">' + esc(c.date) + '</span>' +
      '<div class="tl-body"><h4><span class="tl-dot"></span>' + esc(c.name) + '</h4><p>' + esc(c.desc) + '</p></div>';
    tl.appendChild(node);
  });

  /* ---------- 侧栏高亮 ---------- */
  var navLinks = document.querySelectorAll(".side-nav a[data-sec]");
  var secs = ["top", "redpacket", "activities", "toolbox", "seckill", "feed"].map(function (id) { return $(id); });
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
      var chip = $("dataChip");
      if (!chip) return;
      if (state.hasKey) chip.innerHTML = "<i></i>" + (state.llmReady ? "实时数据 · AI 已增强" : "实时数据");
      else chip.innerHTML = '<i style="background:var(--text-3)"></i>演示数据';
      $("chatMode").textContent = state.llmReady ? "AI 增强" : "实时检索";
    }
  }).catch(function () {
    var chip = $("dataChip"); if (chip) chip.innerHTML = '<i style="background:var(--text-3)"></i>演示数据';
    $("chatMode").textContent = "实时检索";
  });
})();
