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
      /* 新版斜杠式淘口令：3輹👋Zhi6/8WjOTDefEgo/:// CA1501,打開/ */
      if (/(?<![./\w])[A-Za-z0-9]{4,14}\/[A-Za-z0-9]{6,26}\/?(?::\/\/|[，,。]\s*打|打[開开])/.test(s)) return true;
      /* 旧式符号口令：（₤xxxx₤） */
      if (/[₤£¥￥$€][A-Za-z0-9]{8,40}[₤£¥￥$€]/.test(s)) return true;
      /* 商品 id= 形式 */
      if (/[?&]id=\d{6,}/.test(s)) return true;
      return false;
    }

    /* ---------- 从整段「线报分享文案」里提取商品名 ----------
     * 用户从淘宝/线报群复制的整段文案长这样：
     *   7克林斯曼AI扫地机器人…三合一体机【包邮】 【推荐理由】回头客超1百!
     *   【到手价】 534.00 元 【券面额】 105 元 【下单链接】https://m.tb.cn/h.jdyOejm
     *   【领红包】天天领超级红包… 3輹👋Zhi6/8WjOTDefEgo/:// CA1501,打開/
     * 转链要的是商品 ID，口令和 m.tb.cn 短链在开放接口里都提不出 ID ——
     * 但商品名能搜：把链接、【】标签段、口令段、社交尾巴剃掉，最长那段就是商品名。 */
    function extractProductName(text) {
      var s = String(text || "");
      if (!s) return "";
      s = s.replace(/https?:\/\/\S+/g, " ");
      /* 新版斜杠式淘口令整段（…Zhi6/8WjOTDefEgo/:// CA1501,打開/，前段短至 4 字符；
       * 「://」后常有空格再接 CA1501 之类的尾巴，中间用惰性跨空格匹配） */
      s = s.replace(/[\u4e00-\u9fa5A-Za-z0-9]{0,4}[A-Za-z0-9]{4,14}\/[A-Za-z0-9]{5,24}\/?\s*(?::\/\/)?[\s\S]{0,18}?,?\s*打[開开]\/?/g, " ");
      /* 旧式符号口令（₤/£/¥/$/￥ 包裹） */
      s = s.replace(/[₤£¥￥$€][^\s₤£¥￥$€]{5,40}[₤£¥￥$€]/g, " ");
      /* 【标签】段连内容一起去掉（【推荐理由】回头客超1百! 这类） */
      s = s.replace(/【[^【】]{1,40}】/g, " ");
      /* 纯社交动作词（打开/复制/长按…） */
      s = s.replace(/[\u4e00-\u9fa5]{0,3}(打开|打開|复制|長按|长按|发送|分享)/g, " ");
      var segs = s.split(/[\s,，。、!！?？;；~～|]+/).filter(function (x) {
        /* 红包/下单社交尾巴不是商品名 */
        return x && x.length >= 4 && /[\u4e00-\u9fa5]/.test(x) &&
          x.indexOf("红包") < 0 && x.indexOf("下单") < 0 &&
          x.replace(/[0-9.\s]/g, "").length >= 3;
      });
      if (!segs.length) return "";
      segs.sort(function (a, b) { return b.length - a.length; });
      return segs[0].slice(0, 60);
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
        var ok = r && r.converted && (r.url || r.taoCode);
        if (ok) {
          var reply = "转好啦 👇 这就是你的优惠链接，点「打开」直接跳；淘口令可以复制后发微信好友，对方打开淘宝自动识别。";
          done(reply, [], [], [r]);
          return;
        }
        /* 转不出优惠链接（口令/短链提不出商品ID）→ 不把人挡回去：
         * 从整段文案里抠出商品名，直接搜带券商品，卡上照样能领券下单。 */
        var name = extractProductName(text);
        if (name && name.length >= 4) {
          searchModeReply(name, done, {
            prefix: "这条口令/短链转不了优惠通道（开放接口提不出商品ID），我先按商品名「" + name + "」帮你搜到了这些带券好物 👇 以后**直接复制商品名发我**就行，不用带链接口令。",
            links: r && r.url ? [r] : []
          });
          return;
        }
        if (r && r.url) { done((r.note || "这条暂时转不了优惠通道，先给你能打开的链接："), [], [], [r]); return; }
        done("这条我没转换出可用链接 —— 把**商品名**复制发我（比如「xx扫地机器人」），我就能帮你搜到带券商品。", [], [], []);
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
    function searchModeReply(q, done, opts) {
      opts = opts || {};
      var cands = extractKeywords(q);
      /* 长商品名（从整段文案抠出来的那种）再补几个前缀截断变体：
       * 「7克林斯曼AI扫地机器人全自动家用超薄吸尘器智能扫拖吸三合一体机」
       * 全名太长搜不全，但「克林斯曼AI扫地机器人」这种 10 字前后缀命中率很高。
       * 先去掉前导数字（规格前缀「7」「24袋」这类），再从短到长都试一遍。 */
      var base = String(q || "").replace(/[\s,，。、]+/g, "").replace(/^\d+/, "");
      if (base.length > 8) {
        [8, 10, 12, 14, 16, 20, 24].forEach(function (n) {
          if (base.length > n) cands.push(base.slice(0, n));
        });
        cands.push(base);
      }
      var seen = {};
      cands = cands.filter(function (k) { return k && !seen[k] && (seen[k] = 1); });
      if (!cands.length) cands = [q];
      var idx = 0;
      function tryNext() {
        if (idx >= cands.length) {
          done((opts.prefix || "") + "关键词「" + cands[0] + "」暂时没搜到带券商品，换个说法试试？比如直接说商品名。", demoFallback(q), [], opts.links || []);
          return;
        }
        var kw = cands[idx++];
        var last = idx >= cands.length;
        W.apiGet("/api/search?q=" + encodeURIComponent(kw)).then(function (list) {
          var n = Array.isArray(list) ? list.length : 0;
          /* 最后一个候选放宽到 1 个也出（总比空手强）；前面要求 >=2 保证质量 */
          if (n >= (last ? 1 : 2)) {
            done((opts.prefix || "") + "AI 实时选品 · 关键词「" + kw + "」 · 命中 " + n + " 款，挑了几款性价比高的：", list.slice(0, 3), [], opts.links || []);
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
