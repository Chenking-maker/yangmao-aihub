/* 羊毛AIHUB · 微信群页 v2.2
 * 二维码由站长上传：图片放 site/qrcodes/，清单写在 site/qrcodes/groups.json
 * 格式：[{ "name": "群名", "qr": "qrcodes/xxx.png", "desc": "群介绍", "tag": "活跃" }]
 */
(function () {
  "use strict";
  var W = window.WOOL;
  var $ = W.$;
  W.buildTopnav("");

  var grid = $("wxGrid");

  function render(groups) {
    grid.innerHTML = "";
    groups.forEach(function (g) {
      var el = document.createElement("div");
      el.className = "wx-card";
      el.innerHTML =
        '<div class="wx-qr">' +
          '<img src="' + W.esc(g.qr) + '" alt="' + W.esc(g.name) + '" referrerpolicy="no-referrer">' +
        '</div>' +
        '<div class="wx-name">' + W.esc(g.name) + (g.tag ? '<span class="wx-tag">' + W.esc(g.tag) + '</span>' : '') + '</div>' +
        '<div class="wx-desc">' + W.esc(g.desc || "") + '</div>' +
        '<a class="wx-save" href="' + W.esc(g.qr) + '" download="' + W.esc(g.name) + '.png" target="_blank" rel="noopener">保存二维码</a>';
      grid.appendChild(el);
    });
  }

  fetch("qrcodes/groups.json", { cache: "no-store" }).then(function (r) {
    if (!r.ok) throw new Error("http " + r.status);
    return r.json();
  }).then(function (d) {
    var groups = (d && d.groups) || [];
    if (!groups.length) {
      grid.innerHTML = '<div class="empty-note">群主正在上传群二维码，稍后再来看看 ›</div>';
      return;
    }
    render(groups);
  }).catch(function () {
    grid.innerHTML = '<div class="empty-note">群二维码加载失败，刷新页面试试 ›</div>';
  });
})();
