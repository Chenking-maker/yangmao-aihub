/* 羊毛AIHUB · 羊毛集合 v2.1
 * 红包/会场：/api/activities（前端统一呈现，不暴露第三方名）
 * 本地生活：占位卡片，待对接聚合优惠平台
 */
(function () {
  "use strict";
  var W = window.WOOL;
  var $ = W.$;
  W.buildTopnav("coll");

  var API_BASE = W.API_BASE;
  function apiGet(p) { return fetch(API_BASE + p).then(function (r) { return r.json(); }); }
  function apiPost(p, b) { return fetch(API_BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) }).then(function (r) { return r.json(); }); }

  var PLATFORMS = { "1": "淘宝", "2": "京东", "3": "拼多多", "4": "抖音", "5": "美团" };

  /* ---- 红包 / 会场 ---- */
  var collGrid = $("collGrid");
  function renderActivities(list) {
    collGrid.innerHTML = "";
    (list || []).forEach(function (a) {
      var hot = (a.name && (a.name.indexOf("红包") > -1 || a.name.indexOf("主会场") > -1));
      var el = document.createElement("div");
      el.className = "coll-card" + (hot ? " hot" : "");
      el.innerHTML =
        '<div class="coll-top"><span class="coll-pf">' + W.esc(a.platform || PLATFORMS[String(a.platform)] || "活动") + '</span>' +
        '<span class="coll-name">' + W.esc(a.name || "活动会场") + '</span></div>' +
        '<div class="coll-desc">' + W.esc(a.period || "双11 全周期可参与") +
          (a.rebate ? ' <span class="rebate-dot">专属优惠</span>' : (a.needAuth ? ' <span class="rebate-dot soon">待开通</span>' : '')) + '</div>' +
        '<button class="coll-btn">进入领取 ›</button>';
      el.querySelector(".coll-btn").addEventListener("click", function () {
        W.openActivity(a);
      });
      collGrid.appendChild(el);
    });
  }
  apiGet("/api/activities").then(function (list) {
    if (Array.isArray(list) && list.length) renderActivities(list);
    else collGrid.innerHTML = '<div class="empty-note">红包会场加载中，稍后再试</div>';
  }).catch(function () {
    collGrid.innerHTML = '<div class="empty-note">网络开小差了，刷新页面试试</div>';
  });

  /* ---- 本地生活（美团 CPS 实时活动，走好单库） ---- */
  var lifeGrid = $("lifeGrid");
  var lifeSec = lifeGrid ? lifeGrid.closest(".coll-section") : null;

  function lifeFallback() {
    lifeGrid.innerHTML = "";
    var LIFE = [
      { name: "美团", sub: "外卖 / 到店", ico: "🍜", desc: "外卖红包、到店套餐优惠" },
      { name: "饿了么", sub: "外卖", ico: "🥡", desc: "超级会员、红包优惠" },
      { name: "电影票", sub: "购票", ico: "🎬", desc: "影票购票优惠" },
      { name: "打车出行", sub: "打车", ico: "🚕", desc: "打车券、行程优惠" }
    ];
    LIFE.forEach(function (l) {
      var el = document.createElement("div");
      el.className = "life-card";
      el.innerHTML =
        '<div class="life-top"><div class="life-ico">' + l.ico + '</div>' +
        '<div style="flex:1;min-width:0"><div class="life-name">' + l.name + '</div>' +
        '<div class="life-sub">' + l.sub + '</div></div>' +
        '<span class="status-badge soon">即将上线</span></div>' +
        '<div class="life-desc">' + l.desc + '</div>' +
        '<button class="life-btn" disabled>敬请期待</button>';
      lifeGrid.appendChild(el);
    });
    if (lifeSec) {
      var tag = lifeSec.querySelector(".tag");
      if (tag) tag.textContent = "即将上线";
      var note = lifeSec.querySelector(".coll-note");
      if (note) note.textContent = "美团 / 饿了么 / 电影票 / 打车等本地生活优惠正在开通中，上线后可直接领券下单更优惠。";
    }
  }

  apiGet("/api/life/business").then(function (r) {
    if (!r || !r.configured || !r.items || !r.items.length) { lifeFallback(); return; }
    if (lifeSec) {
      var tag = lifeSec.querySelector(".tag");
      if (tag) tag.textContent = "已开通 " + r.items.length + " 项 · 实时同步";
      var note = lifeSec.querySelector(".coll-note");
      if (note) note.textContent = "美团外卖、闪购、神券等本地生活优惠，点「获取优惠链接」生成你的专属链接，打开领券下单更划算。";
    }
    lifeGrid.innerHTML = "";
    r.items.forEach(function (b) {
      var el = document.createElement("div");
      el.className = "life-card on";
      var ico = b.image
        ? '<div class="life-ico img"><img src="' + W.esc(b.image) + '" referrerpolicy="no-referrer" alt=""></div>'
        : '<div class="life-ico">' + (b.icon || "🎁") + '</div>';
      el.innerHTML =
        '<div class="life-top">' + ico +
        '<div style="flex:1;min-width:0"><div class="life-name">' + W.esc(b.name) + '</div>' +
        '<div class="life-sub">' + W.esc(b.cat) + (b.commission ? " · 佣金 " + W.esc(b.commission) : "") + '</div></div>' +
        '<span class="status-badge on">可领</span></div>' +
        '<div class="life-desc">' + W.esc(b.desc || "点击生成专属优惠链接，领券下单更划算") + '</div>' +
        '<button class="life-btn on">获取优惠链接 ›</button>';
      el.querySelector(".life-btn").addEventListener("click", function () {
        var btn = el.querySelector(".life-btn");
        btn.disabled = true;
        btn.textContent = "生成中…";
        apiPost("/api/life/link", { id: b.id }).then(function (res) {
          btn.disabled = false;
          btn.textContent = "获取优惠链接 ›";
          if (res && res.url) {
            window.open(res.url, "_blank", "noopener");
          } else {
            W.toast((res && res.error) || "没取到链接，稍后再试");
          }
        }).catch(function () {
          btn.disabled = false;
          btn.textContent = "获取优惠链接 ›";
          W.toast("网络开小差了，再试一次");
        });
      });
      lifeGrid.appendChild(el);
    });
  }).catch(lifeFallback);
})();
