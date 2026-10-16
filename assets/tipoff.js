/* 羊毛AIHUB · 实时线报广场 v2.7（排版重设计）
 * 数据源：好单库线报接口（前端统一呈现为「AI 线报」）/ 素材圈子（宠物/美妆）
 * 每条线报的产品可一键转成用户自己的优惠链接
 */
(function () {
  "use strict";
  var W = window.WOOL;
  var $ = W.$;
  W.buildTopnav("tipoff");

  var API_BASE = W.API_BASE;
  function apiGet(p) { return fetch(API_BASE + p).then(function (r) { return r.json(); }); }
  function apiPost(p, b) { return fetch(API_BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) }).then(function (r) { return r.json(); }); }

  // 固定的「素材类」线报（宠物/美妆）走 material 通道
  var TABS = [
    { key: "all", label: "全部", icon: "🧩", src: "wire", q: "0" },
    { key: "fz", label: "飞猪旅行", icon: "✈️", src: "wire", q: "10367" },
    { key: "by", label: "淘宝百亿补贴", icon: "🛒", src: "wire", q: "10005" },
    { key: "tb", label: "淘宝实时线报", icon: "📦", src: "wire", q: "10003" },
    { key: "jd", label: "京东实时线报", icon: "🏷️", src: "wire", q: "10004" },
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

  function renderWireItem(it) {
    var card = document.createElement("div");
    card.className = "wire-card";
    // 行结构：content=文字说明；item_id=淘口令 token（紧跟着商品描述出现）
    var linesHtml = "";
    it.lines.forEach(function (l) {
      if (l.itemId && !l.text) {
        linesHtml += '<div class="wire-foot"><button class="wire-btn act-convert" data-text="' +
          encodeURIComponent(l.itemId) + '">🛒 获取购买链接</button></div>';
      } else if (l.text) {
        linesHtml += '<div class="wire-line">' + W.esc(l.text) + '</div>';
        if (hasLink(l.text)) {
          linesHtml += '<div class="wire-foot"><button class="wire-btn act-convert" data-text="' +
            encodeURIComponent(l.text) + '">🔗 转我的链接</button></div>';
        }
      }
    });

    var imgsHtml = (it.images && it.images.length)
      ? '<div class="wire-imgs">' + it.images.map(function (u) {
          return '<img loading="lazy" src="' + API_BASE + '/api/img?u=' + encodeURIComponent(u) + '" referrerpolicy="no-referrer" alt="">';
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
    for (var i = 0; i < 4; i++) {
      var sk = document.createElement("div");
      sk.className = "wire-sk";
      sk.innerHTML =
        '<div class="wire-sk-top"><span class="wire-sk-badge"></span><span class="wire-sk-line w40"></span></div>' +
        '<div class="wire-sk-line w90"></div><div class="wire-sk-line w75"></div><div class="wire-sk-line w60"></div>' +
        '<div class="wire-sk-imgs"><span></span><span></span><span></span></div>' +
        '<div class="wire-sk-btn"></div>';
      listEl.appendChild(sk);
    }
  }

  function showEmpty(tab) {
    var msg = tab.src === "material"
      ? tab.label + "：暂无推荐好物，稍后再来看看"
      : tab.label + "：暂时没有新线报，换分类看看";
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

  function loadList(tab) {
    loading = true;
    setRefreshing(true);
    metaEl.textContent = "";
    showSkeleton();
    var url = tab.src === "material"
      ? "/api/wire?sub=material&tag=" + encodeURIComponent(tab.q)
      : "/api/wire?sub=list&type=" + encodeURIComponent(tab.q) + "&page=1";
    apiGet(url).then(function (d) {
      loading = false;
      setRefreshing(false);
      listEl.innerHTML = "";
      var items = (d && d.items) || [];
      if (!items.length) { showEmpty(tab); return; }
      metaEl.innerHTML = '当前分类共 <b>' + items.length + '</b> 条线报 · 数据实时同步';
      items.forEach(function (it) { listEl.appendChild(renderWireItem(it)); });
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
