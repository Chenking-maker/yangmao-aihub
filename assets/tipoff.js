/* 羊毛AIHUB · 实时线报广场 v2.15
 * 数据源：好单库线报接口（前端统一呈现为「AI 线报」）/ 素材圈子（宠物/美妆）
 *  ·
 *  ·  性能：每个分类「时间窗口 + 条数上限」双限（全部 12h/50 条，飞猪 7 天/100 条，
 *  ·        百亿补贴·淘宝实时·京东实时 24h/200 条），分母可控；前端分批渲染 + 图片懒加载，
 *  ·        打开不再一次性灌几百张图，卡顿消失。
 *  ·  星标：整条线报一个星标（进「星标宝贝 · 实时线报」，存的是**完整快照**：
 *  ·        全文 + 图片 + 每行商品链接 —— 因为线报广场是流动的，过期就找不到原帖了；
 *  ·        线报里的每个商品链接另有单独星标（进「星标宝贝 · 线报好物」）。
 */
(function () {
  "use strict";
  var W = window.WOOL;
  var $ = W.$;
  W.buildTopnav("tipoff");

  var API_BASE = W.API_BASE;
  function apiGet(p) { return fetch(API_BASE + p).then(function (r) { return r.json(); }); }
  function apiPost(p, b) { return fetch(API_BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) }).then(function (r) { return r.json(); }); }

  /* 每个分类的窗口：hours=时间窗口（小时），max=最多保留条数 */
  var TABS = [
    { key: "all", label: "全部", icon: "🧩", src: "wire", q: "0", hours: 12, max: 50 },
    { key: "fz", label: "飞猪旅行", icon: "✈️", src: "wire", q: "10367", hours: 168, max: 100 },
    { key: "by", label: "淘宝百亿补贴", icon: "🛒", src: "wire", q: "10005", hours: 24, max: 200 },
    { key: "tb", label: "淘宝实时线报", icon: "📦", src: "wire", q: "10003", hours: 24, max: 200 },
    { key: "jd", label: "京东实时线报", icon: "🏷️", src: "wire", q: "10004", hours: 24, max: 200 },
    { key: "pet", label: "宠物线报", icon: "🐾", src: "material", q: "宠物" },
    { key: "beauty", label: "美妆线报", icon: "💄", src: "material", q: "美妆" }
  ];

  var tabsEl = $("wireTabs");
  var listEl = $("wireList");
  var metaEl = $("wireMeta");
  var refreshBtn = $("wireRefresh");
  var current = "all";
  var loading = false;

  // 渲染 pill tabs
  TABS.forEach(function (t) {
    var b = document.createElement("button");
    b.className = "wire-tab" + (t.key === current ? " active" : "");
    b.innerHTML = '<span class="wire-tab-ico">' + t.icon + '</span>' + t.label;
    b.setAttribute("data-key", t.key);
    b.addEventListener("click", function () {
      if (t.key === current || loading) return;
      tabsEl.querySelectorAll(".wire-tab").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      current = t.key;
      loadList(t);
    });
    tabsEl.appendChild(b);
  });

  function hasLink(text) {
    return /https?:\/\//.test(text) || /(taobao|tmall|tb\.cn)/i.test(text) ||
      /\b[A-Za-z0-9]{10,}-[A-Za-z0-9]{10,}[A-Za-z0-9]*\b/.test(text) ||
      /jd\.com|u\.jd\.com|item\.jd/i.test(text);
  }

  function platformClass(pf) {
    if (pf === "京东") return "jd";
    if (pf === "飞猪") return "fz";
    if (pf === "淘宝" || pf === "天猫") return "tb";
    return "";
  }

  function strip(s) {
    return String(s || "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  }

  /* 从线报文字里粗略估个价（有「券后/到手 xx 元」或两个以上价格时才用，估不准就不填） */
  function parsePrice(text) {
    var t = String(text || "");
    var nums = [], re = /(\d+(?:\.\d+)?)\s*(?:元|块)/g, m;
    while ((m = re.exec(t))) {
      var v = parseFloat(m[1]);
      if (v > 0 && v < 200000) nums.push(v);
    }
    if (nums.length >= 2) {
      var mx = Math.max.apply(null, nums), mn = Math.min.apply(null, nums);
      if (mx > mn) return { price: mx, endPrice: mn };
    }
    var m2 = t.match(/(?:券后|到手|秒杀|活动价|补贴后|立减后)[^\d]{0,8}(\d+(?:\.\d+)?)/);
    if (m2) {
      var v2 = parseFloat(m2[1]);
      if (v2 > 0 && v2 < 200000) return { price: 0, endPrice: v2 };
    }
    return { price: 0, endPrice: 0 };
  }

  function wireText(it) {
    return strip((it.lines || []).map(function (l) { return l.text || ""; }).filter(Boolean).join(" "));
  }

  /* 一根线报里所有「能转链的行」 */
  function wireLinks(it) {
    var out = [];
    (it.lines || []).forEach(function (l, i) {
      var link = l.itemId || (l.text && hasLink(l.text) ? l.text : "");
      if (!link) return;
      out.push({ i: i, link: link, text: l.text || "", pureToken: !!(l.itemId && !l.text) });
    });
    return out;
  }

  /* 整条线报 → 星标项。
   * 关键：星标「整条线报」时把这条线报的内容整个存一份快照（全部文字行 + 图片 + 每行的商品链接），
   * 因为线报广场是流动的 —— 12 小时后就滚出去了，原帖根本找不回来。
   * 存全量后，星标宝贝里直接就是这条线报的完整原文，每行商品都还能点开转链。
   * 体积控制：最多 30 行、每行 300 字、最多 3 张图（localStorage 有配额）。 */
  var WIRE_SNAP_LINES = 30;
  var WIRE_SNAP_CHARS = 300;
  var WIRE_SNAP_IMGS = 3;

  function wireStarItem(it) {
    var text = wireText(it);
    var lines = [];
    (it.lines || []).forEach(function (l) {
      if (lines.length >= WIRE_SNAP_LINES) return;
      var t = String(l.text || "").trim();
      var link = l.itemId || (t && hasLink(t) ? t : "");
      if (!t && !link) return;
      lines.push({ t: t.slice(0, WIRE_SNAP_CHARS), l: String(link || "") });
    });
    return {
      k: "w:" + it.id,
      type: "wire",
      title: text.slice(0, 240) || (it.platform + " · " + (it.time || "实时线报")),
      lines: lines,
      images: (it.images || []).slice(0, WIRE_SNAP_IMGS),
      pic: (it.images && it.images[0]) || "",
      platform: it.platform,
      category: it.category || "",
      time: it.time || "",
      save: 0
    };
  }

  /* 线报里的单个商品 → 星标项（「线报好物」类，点开直接转链打开） */
  function linkStarItem(it, idx, link, lineText) {
    var all = wireText(it);
    var base = strip(lineText).replace(/^[·\-—\s]+/, "") || all;
    var pr = parsePrice((lineText || "") + " " + all);
    var save = (pr.price > 0 && pr.endPrice > 0 && pr.price > pr.endPrice)
      ? Math.round((pr.price - pr.endPrice) * 10) / 10 : 0;
    return {
      k: "wl:" + it.id + ":" + idx,
      type: "wirelink",
      title: base.slice(0, 140) || (it.platform + " · " + (it.time || "线报好物")),
      link: link,
      pic: (it.images && it.images[0]) || "",
      platform: it.platform,
      time: it.time || "",
      price: pr.price || 0,
      endPrice: pr.endPrice || 0,
      save: save
    };
  }

  function renderWireItem(it) {
    var card = document.createElement("div");
    card.className = "wire-card";
    // 行结构：content=文字说明；item_id=淘口令 token（紧跟着商品描述出现）
    var linesHtml = "";
    (it.lines || []).forEach(function (l, idx) {
      var link = l.itemId || (l.text && hasLink(l.text) ? l.text : "");
      if (l.text) linesHtml += '<div class="wire-line">' + W.esc(l.text) + '</div>';
      if (link) {
        linesHtml += '<div class="wire-foot" data-i="' + idx + '">' +
          '<button class="wire-btn act-convert" data-text="' + encodeURIComponent(link) + '">' +
          (l.itemId && !l.text ? "🛒 获取购买链接" : "🔗 转我的链接") + '</button></div>';
      }
    });

    var imgsHtml = (it.images && it.images.length)
      ? '<div class="wire-imgs">' + it.images.map(function (u) {
          return '<img loading="lazy" decoding="async" src="' + API_BASE + '/api/img?u=' + encodeURIComponent(u) + '" referrerpolicy="no-referrer" alt="">';
        }).join("") + '</div>'
      : "";

    card.innerHTML =
      '<div class="wire-card-top">' +
        '<span class="wire-pf ' + platformClass(it.platform) + '">' + W.esc(it.platform) + '</span>' +
        '<span class="wire-cate">' + W.esc(it.category || "") + '</span>' +
        '<span class="wire-time">' + W.esc(it.time || "") + '</span>' +
      '</div>' +
      '<div class="wire-lines">' + linesHtml + '</div>' +
      imgsHtml;

    // ① 整条线报的星标（右侧「实时线报」）
    var top = card.querySelector(".wire-card-top");
    if (top) top.appendChild(W.starBtn(wireStarItem(it)));

    // ② 每个商品链接单独一个星标（「线报好物」）—— 点开就能转链打开
    var links = wireLinks(it);
    card.querySelectorAll(".wire-foot").forEach(function (foot, n) {
      var lk = links[n];
      if (!lk) return;
      foot.appendChild(W.starBtn(linkStarItem(it, lk.i, lk.link, lk.text), "收藏"));
    });

    // 绑定转链按钮
    card.querySelectorAll(".act-convert").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var text = decodeURIComponent(btn.getAttribute("data-text"));
        btn.disabled = true;
        btn.textContent = "获取中…";
        apiPost("/api/convert", { text: text }).then(function (r) {
          if (r && r.url) {
            btn.textContent = "已获取 · 请打开";
            btn.disabled = false;
            btn.onclick = function () { window.open(r.url, "_blank", "noopener"); };
            if (r.taoCode) {
              var copy = document.createElement("button");
              copy.className = "wire-btn ghost";
              copy.textContent = "复制淘口令";
              copy.addEventListener("click", function () { W.copyText(r.taoCode, "淘口令已复制，打开淘宝自动识别"); });
              btn.parentNode.insertBefore(copy, btn.nextSibling);
            }
            W.toast(r.note || "已获取你的专属优惠链接");
          } else if (r && r.note) {
            btn.textContent = "⚠ " + r.note;
            btn.disabled = false;
          } else {
            btn.textContent = "获取失败，换一条试试";
            btn.disabled = false;
          }
        }).catch(function () {
          btn.textContent = "网络开小差，重试";
          btn.disabled = false;
        });
      });
    });
    return card;
  }

  /* ---- 骨架屏 ---- */
  function showSkeleton() {
    listEl.innerHTML = "";
    for (var i = 0; i < 3; i++) {
      var sk = document.createElement("div");
      sk.className = "wire-sk";
      sk.innerHTML =
        '<div class="wire-sk-top"><span class="wire-sk-badge"></span><span class="wire-sk-line w40"></span></div>' +
        '<div class="wire-sk-line w90"></div><div class="wire-sk-line w75"></div>' +
        '<div class="wire-sk-imgs"><span></span><span></span><span></span></div>' +
        '<div class="wire-sk-btn"></div>';
      listEl.appendChild(sk);
    }
  }

  function showEmpty(tab) {
    var msg = tab.src === "material"
      ? "「" + tab.label + "」暂无推荐好物，稍后再来看看"
      : "「" + tab.label + "」暂时没有新线报，换分类看看";
    listEl.innerHTML =
      '<div class="wire-empty">' +
        '<div class="wire-empty-ico">' + tab.icon + '</div>' +
        '<div class="wire-empty-text">' + msg + '</div>' +
        '<button class="wire-empty-btn" id="wireEmptyBtn">看看全部线报</button>' +
      '</div>';
    var eb = $("wireEmptyBtn");
    if (eb) eb.addEventListener("click", function () {
      tabsEl.querySelector('[data-key="all"]').click();
    });
  }

  function setRefreshing(on) {
    refreshBtn.classList.toggle("spinning", on);
    refreshBtn.disabled = on;
  }

  function windowText(hours) {
    if (!hours) return "全部";
    return hours >= 48 ? Math.round(hours / 24) + " 天" : hours + " 小时";
  }

  var WIRE_BATCH = 24;

  /* 一次几十上百条线报，分批渲染：先出 24 条，剩下的点「加载更多」 */
  function renderBatch(items, from) {
    var end = Math.min(items.length, from + WIRE_BATCH);
    for (var i = from; i < end; i++) listEl.appendChild(renderWireItem(items[i]));
    var old = $("wireMore");
    if (old) old.remove();
    if (end < items.length) {
      var btn = document.createElement("button");
      btn.className = "wire-more";
      btn.id = "wireMore";
      btn.textContent = "加载更多（还有 " + (items.length - end) + " 条）";
      btn.addEventListener("click", function () { btn.remove(); renderBatch(items, end); });
      listEl.appendChild(btn);
    }
  }

  function loadList(tab) {
    loading = true;
    setRefreshing(true);
    metaEl.textContent = "";
    showSkeleton();
    var url = tab.src === "material"
      ? "/api/wire?sub=material&tag=" + encodeURIComponent(tab.q)
      : "/api/wire?sub=list&type=" + encodeURIComponent(tab.q) +
        "&hours=" + tab.hours + "&max=" + tab.max;
    apiGet(url).then(function (d) {
      loading = false;
      setRefreshing(false);
      listEl.innerHTML = "";
      var items = (d && d.items) || [];
      if (!items.length) { showEmpty(tab); return; }
      if (tab.src === "material") {
        metaEl.innerHTML = '共 <b>' + items.length + '</b> 条推荐好物 · 点卡片右上角 ⭐ 收藏整条，商品行点「收藏」存单个宝贝';
      } else {
        var hours = (d && d.hours) || tab.hours;
        var max = (d && d.max) || tab.max;
        metaEl.innerHTML = '最近 <b>' + windowText(hours) + '</b> 共 <b>' + items.length +
          '</b> 条线报（最多保留 ' + max + ' 条，最新在前）· ⭐ 可收藏整条或单个宝贝';
      }
      renderBatch(items, 0);
    }).catch(function () {
      loading = false;
      setRefreshing(false);
      listEl.innerHTML =
        '<div class="wire-empty">' +
          '<div class="wire-empty-ico">📡</div>' +
          '<div class="wire-empty-text">网络开小差了，刷新页面试试</div>' +
        '</div>';
    });
  }

  refreshBtn.addEventListener("click", function () {
    var tab = TABS.filter(function (t) { return t.key === current; })[0];
    loadList(tab);
  });

  loadList(TABS[0]);
})();
