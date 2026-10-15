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
        '<div class="coll-desc">' + W.esc(a.period || "双11 全周期可参与") + '</div>' +
        '<button class="coll-btn">进入领取 ›</button>';
      el.querySelector(".coll-btn").addEventListener("click", function () {
        if (a.url) {
          if (a.platform === "淘宝") {
            W.toast("正在生成领取链接…");
            apiPost("/api/redpacket", { activityId: a.activityId, activityUrl: a.url, title: a.name })
              .then(function (r) { window.open((r && r.url) || a.url, "_blank", "noopener"); })
              .catch(function () { window.open(a.url, "_blank", "noopener"); });
          } else { window.open(a.url, "_blank", "noopener"); }
        } else {
          W.toast("打开「" + (a.name || "活动") + "」：进入对应 APP 搜索同名会场");
        }
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

  /* ---- 本地生活（聚合优惠平台，占位） ---- */
  var lifeGrid = $("lifeGrid");
  var LIFE = [
    { name: "美团", sub: "外卖 / 到店", ico: "🍜", desc: "外卖红包、到店套餐优惠", status: "soon" },
    { name: "饿了么", sub: "外卖", ico: "🥡", desc: "超级会员、红包优惠", status: "soon" },
    { name: "滴滴出行", sub: "打车", ico: "🚕", desc: "打车券、行程优惠", status: "soon" },
    { name: "电影票", sub: "购票", ico: "🎬", desc: "影票购票优惠", status: "soon" },
    { name: "话费充值", sub: "充值", ico: "📱", desc: "话费慢充优惠", status: "soon" },
    { name: "加油", sub: "车主", ico: "⛽", desc: "加油充值优惠", status: "soon" }
  ];
  LIFE.forEach(function (l) {
    var on = l.status === "on";
    var el = document.createElement("div");
    el.className = "life-card";
    el.innerHTML =
      '<div class="life-top"><div class="life-ico">' + l.ico + '</div>' +
      '<div style="flex:1;min-width:0"><div class="life-name">' + l.name + '</div>' +
      '<div class="life-sub">' + l.sub + '</div></div>' +
      '<span class="status-badge ' + (on ? "on" : "soon") + '">' + (on ? "已开通" : "对接中") + '</span></div>' +
      '<div class="life-desc">' + l.desc + '</div>' +
      '<button class="life-btn ' + (on ? "on" : "") + '"' + (on ? "" : " disabled") + '>' +
        (on ? "立即领券 ›" : "敬请期待") + '</button>';
    if (on) el.querySelector(".life-btn").addEventListener("click", function () { window.open(l.url || "#", "_blank", "noopener"); });
    lifeGrid.appendChild(el);
  });
})();
