/* 羊毛AIHUB · 共享对话核心 v2.3
 * index.html（紧凑版）与 chat.html（放大版）共用同一套多轮对话逻辑：
 * 多轮上下文 / 商品卡 / 红包卡 / 转链卡 / 无 LLM 降级实时检索 / ?q= 预填
 * 用法：
 *   WOOL.mountChat({
 *     body: "chatBody", input: "chatInput", send: "chatSend",
 *     mode: "chatMode",          // 可选：显示「AI 增强 / 实时检索」角标
 *     chips: [...],              // 可选：欢迎快捷提问（默认全套）
 *     prefill: true              // 可选：读取 ?q= 自动发送
 *   });
 * 前端统一用「优惠」表述，不出现"返利"。
 */
(function (global) {
  "use strict";

  var W = global.WOOL;
  if (!W) return;
  var $ = W.$;

  var DEFAULT_CHIPS = [
    "给爸妈买 200 元以内的纯牛奶",
    "9.9 包邮有什么值得买",
    "双11 超级红包怎么领",
    "满200减25怎么凑单",
    "聚划算今天有什么好价",
    "把淘宝链接转成我的优惠链接"
  ];

  function mountChat(cfg) {
    cfg = cfg || {};
    var chatBody = $(cfg.body || "chatBody");
    var chatInput = $(cfg.input || "chatInput");
    var chatSend = $(cfg.send || "chatSend");
    var modeEl = cfg.mode ? $(cfg.mode) : null;
    if (!chatBody || !chatInput || !chatSend) return null;

    var chips = cfg.chips || DEFAULT_CHIPS;
    var state = { llmReady: false };
    var chatHistory = [], chatBusy = false;

    /* ---------- 欢迎 ---------- */
    function renderWelcome() {
      chatBody.innerHTML =
        '<div class="chat-welcome">' +
          '<div class="welcome-emoji">🐑</div>' +
          '<div class="big">想买什么，跟羊毛AI 说一声</div>' +
          '<div class="sub">帮你找隐藏优惠券、领双11 红包、算凑单；发淘宝/京东链接，还能直接转成你的优惠链接。全免费。</div>' +
          '<div class="welcome-chips">' +
            chips.map(function (q) { return '<button class="wchip">' + W.esc(q) + '</button>'; }).join("") +
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
      el.innerHTML = '<div class="msg-av">我</div><div class="bubble">' + W.esc(text) + '</div>';
      chatBody.appendChild(el); scrollChat();
    }

    /* ---------- 转链卡 ---------- */
  function linkCardHtml(r) {
    var jd = r.platform === "京东";
    var url = String(r.url || "");
    /* 链接很长，中间省略显示，完整链接放 title 里（悬停/长按可见） */
    var short = url.length > 44 ? url.slice(0, 20) + "…" + url.slice(-14) : url;
    var status = r.converted
      ? '<span class="badge-coupon">已转成优惠链接</span>'
      : '<span class="wire-note">' + W.esc(r.note || "暂未转链") + '</span>';
    /* 淘口令单独一行：淘宝生态里口令比链接好用（微信里点不开链接，但口令能直接唤起 APP） */
    var taoLine = r.taoCode
      ? '<div class="conv-tao"><span class="conv-tao-k">淘口令</span>' +
        '<span class="conv-tao-v">' + W.esc(r.taoCode) + '</span>' +
        '<button class="rp-msg-btn ghost" data-act="tao">复制口令</button></div>'
      : "";
    var couponLine = (Number(r.coupon) > 0) ? '<div class="wire-note">这张券 ' + r.coupon + ' 元，下单一起抵现</div>' : '';
    var btns = url
      ? '<button class="rp-msg-btn" data-act="open">打开</button><button class="rp-msg-btn ghost" data-act="copy">复制链接</button>'
      : (r.taoCode ? '<button class="rp-msg-btn" data-act="tao">复制淘口令</button>' : '');
    var ico = jd ? "🎁" : "🧧";
    return '<div class="rp-msg-card' + (jd ? " jd" : "") + '">' +
      '<div class="rp-msg-ico">' + ico + '</div>' +
      '<div class="rp-msg-info">' +
        '<div class="rp-msg-name">' + (jd ? "京东" : "淘宝") + '链接 · 优惠通道</div>' +
        '<div class="rp-msg-url" title="' + W.esc(url) + '">' +
          W.esc(short || (r.taoCode ? "已生成淘口令（见下方）" : "待转链")) + '</div>' +
        taoLine +
      '</div>' +
      '<div class="rp-msg-actions">' + btns + '</div>' +
    '</div>' + status + couponLine;
  }

    function bindCardActions(rootEl, links, redpackets) {
      rootEl.querySelectorAll(".rp-msg-card").forEach(function (card, i) {
        var r = (links && links[i]) || (redpackets && redpackets[i]);
        var open = card.querySelector('[data-act="open"]');
        if (open) open.addEventListener("click", function () { if (r && r.url) window.open(r.url, "_blank", "noopener"); });
        var cp = card.querySelector('[data-act="copy"]');
        if (cp) cp.addEventListener("click", function () { W.copyText(r.url, "链接已复制"); });
        var tao = card.querySelector('[data-act="tao"]');
        if (tao) tao.addEventListener("click", function () { W.copyText(r.taoCode, "淘口令已复制，打开淘宝自动识别"); });
      });
    }

    function appendAiMsg(text, products, redpackets, links) {
      var el = document.createElement("div");
      el.className = "msg msg-ai";
      var cardsHtml = "";
      if (products && products.length) cardsHtml += '<div class="msg-cards" data-cards="products"></div>';
      if (links && links.length) cardsHtml += '<div class="msg-cards">' + links.map(linkCardHtml).join("") + '</div>';
      if (redpackets && redpackets.length) {
        cardsHtml += redpackets.map(function (r) {
          var jd = r.platform === "京东";
          return '<div class="msg-cards"><div class="rp-msg-card' + (jd ? " jd" : "") + '">' +
            '<div class="rp-msg-ico">' + (jd ? "🎁" : "🧧") + '</div>' +
            '<div class="rp-msg-info"><div class="rp-msg-name">' + W.esc(r.name) + ' · ' + W.esc(r.platform) + '</div>' +
            '<div class="rp-msg-url">' + W.esc(r.url) + '</div></div>' +
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
        products.forEach(function (p) { wrap.appendChild(W.productCard(p)); });
      }
      bindCardActions(el, links, redpackets);
      scrollChat();
    }

    function formatReply(text) {
      var html = W.esc(text);
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

    /* ---------- 发送 ---------- */
    /* 识别消息里有没有「可转链的物料」：淘宝/京东商品链接、淘口令 token。
     * 命中就走 /api/convert 直转链 —— 不依赖 LLM（没配/超时都能用），
     * 几百毫秒到 2 秒就出结果，比让 AI 绕一圈可靠得多。 */
    function detectLink(text) {
      var s = String(text || "");
      if (!s) return false;
      if (/https?:\/\//i.test(s)) {
        if (/(taobao|tmall|tb\.cn|jd\.com|3\.cn)/i.test(s)) return true;
      }
      /* 淘口令/分享 token：10 位以上、中间带 - 的 base62 串 */
      if (/\b[A-Za-z0-9]{10,}-[A-Za-z0-9]{10,}[A-Za-z0-9]*\b/.test(s)) return true;
      /* 商品 id= 形式 */
      if (/[?&]id=\d{6,}/.test(s)) return true;
      return false;
    }

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
      if (detectLink(text)) {
        /* 发的是链接/口令 → 直接转链 */
        convertModeReply(text, done);
      } else if (state.llmReady) {
        W.apiPost("/api/chat", { messages: chatHistory.slice(-8) }).then(function (r) {
          if (r && r.reply !== undefined) done(r.reply, r.products, r.redpackets, r.links);
          else searchModeReply(text, done);
        }).catch(function () { searchModeReply(text, done); });
      } else {
        searchModeReply(text, done);
      }
    }

    /* ---------- 直转链：发链接 → 回优惠链接 + 口令 ---------- */
    function convertModeReply(text, done) {
      W.apiPost("/api/convert", { text: text }).then(function (r) {
        if (!r || (!r.url && !r.taoCode)) {
          done("这条我没转换出可用链接 —— 把淘宝/京东的**商品链接**或者**淘口令**再发我一次试试（要含 http 的那种）。", [], [], []);
          return;
        }
        var reply = r.converted
          ? "转好啦 👇 这就是你的优惠链接，点「打开」直接跳；淘口令可以复制后发微信好友，对方打开淘宝自动识别。"
          : (r.note || "这条暂时转不了优惠通道，先把能打开的链接给你：");
        done(reply, [], [], [r]);
      }).catch(function () {
        done("网络开小差了，转链没成功，再发一次链接试试？", [], [], []);
      });
    }

    /* ---------- 无 LLM 降级：实时检索 ---------- */
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
    function demoFallback(q) {
      var map = { 牛奶: "d001", 咖啡: "d008", 耳机: "d006", 牙刷: "d011", 抽纸: "d002", 湿巾: "d010", 巧克力: "d003", 板鞋: "d004", 羽绒: "d005", 吸尘器: "d009", 泡面: "d009", 精华: "d007", 袜: "d012" };
      for (var k in map) if (q.indexOf(k) > -1) return window.PRODUCTS.filter(function (p) { return p.id === map[k]; });
      return window.PRODUCTS.slice(0, 2);
    }
    function searchModeReply(q, done) {
      var cands = extractKeywords(q);
      if (!cands.length) cands = [q];
      var idx = 0;
      function tryNext() {
        if (idx >= cands.length) { done("关键词「" + cands[0] + "」暂时没搜到带券商品，换个说法试试？比如直接说商品名。", demoFallback(q), [], []); return; }
        var kw = cands[idx++];
        W.apiGet("/api/search?q=" + encodeURIComponent(kw)).then(function (list) {
          if (Array.isArray(list) && list.length >= 3) {
            done("AI 实时选品 · 关键词「" + kw + "」 · 命中 " + list.length + " 款，挑了几款性价比高的：", list.slice(0, 3), [], []);
          } else tryNext();
        }).catch(function () { done("网络开小差了，先用演示数据顶一下：", demoFallback(q), [], []); });
      }
      tryNext();
    }

    chatSend.addEventListener("click", function () { sendChat(chatInput.value); });
    chatInput.addEventListener("keydown", function (e) { if (e.key === "Enter") sendChat(chatInput.value); });

    /* ---------- 健康检查 ---------- */
    function setMode(t) { if (modeEl) modeEl.textContent = t; }
    W.apiGet("/api/health").then(function (h) {
      state.llmReady = !!(h && h.ok && h.hasLLM);
      setMode(state.llmReady ? "AI 增强" : "实时检索");
    }).catch(function () { setMode("实时检索"); });

    /* ---------- ?q= 预填 ---------- */
    if (cfg.prefill) {
      try {
        var q = new URLSearchParams(location.search).get("q");
        if (q) setTimeout(function () { sendChat(q); }, 300);
      } catch (e) {}
    }

    return { sendChat: sendChat };
  }

  global.WOOL.mountChat = mountChat;
})(window);
