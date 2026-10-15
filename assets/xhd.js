/* 羊毛AIHUB · 消灭小红包专区 v2.2
 * 数据：/api/xhd（9.9 包邮榜里券后价低于 9.9 的商品，按到手价从低到高）
 * 领券购买统一走 /api/coupon（ratesurl 转链，带用户归因参数）
 */
(function () {
  "use strict";
  var W = window.WOOL;
  var $ = W.$;
  W.buildTopnav("");

  var grid = $("xhdGrid");
  grid.innerHTML = '<div class="empty-note">正在搜集 9.9 以下好物…</div>';

  W.apiGet("/api/xhd").then(function (list) {
    grid.innerHTML = "";
    var arr = Array.isArray(list) ? list : [];
    if (!arr.length) {
      grid.innerHTML = '<div class="empty-note">这批被抢光了，稍后再来看看 ›</div>';
      return;
    }
    arr.forEach(function (p) {
      var card = W.productCard(p);
      var badge = document.createElement("div");
      badge.className = "xhd-badge";
      badge.textContent = "🧧 红包可抵";
      card.querySelector(".pcard-price").appendChild(badge);
      grid.appendChild(card);
    });
  }).catch(function () {
    grid.innerHTML = '<div class="empty-note">网络开小差了，刷新页面试试 ›</div>';
  });
})();
