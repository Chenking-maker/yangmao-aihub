/* 羊毛AIHUB · 创作者介绍页 v2.2 */
(function () {
  "use strict";
  var W = window.WOOL;
  var $ = W.$;
  W.buildTopnav("");

  var mascot = $("aboutMascot");
  if (mascot) mascot.innerHTML = W.LOGO_SVG;

  /* ---- 社交账号 ----
   * 默认按「同名搜索」跳转；拿到主页直链后，把 url 换成对应主页即可 */
  var LINKS = [
    {
      ico: "📮",
      name: "微博",
      id: "省钱作业君",
      desc: "双11 攻略 · 捡漏心得 · 日常碎碎念",
      url: "https://s.weibo.com/user?q=" + encodeURIComponent("省钱作业君"),
      btn: "去微博关注 ›"
    },
    {
      ico: "📕",
      name: "小红书",
      id: "省钱作业君",
      desc: "薅羊毛笔记 · 好物清单 · 避坑指南",
      url: "https://www.xiaohongshu.com/search_result?keyword=" + encodeURIComponent("省钱作业君"),
      btn: "去小红书关注 ›"
    },
    {
      ico: "💬",
      name: "微信",
      id: "省钱作业君",
      desc: "搜同名加我，拉你进羊毛交流群",
      url: "wechat.html",
      btn: "扫码进群 ›"
    }
  ];

  var grid = $("socialGrid");
  LINKS.forEach(function (l) {
    var el = document.createElement("a");
    el.className = "social-card";
    el.href = l.url;
    if (/^https?:/.test(l.url)) { el.target = "_blank"; el.rel = "noopener"; }
    el.innerHTML =
      '<div class="social-ico">' + l.ico + '</div>' +
      '<div class="social-info">' +
        '<div class="social-name">' + W.esc(l.name) + ' <span class="social-id">@' + W.esc(l.id) + '</span></div>' +
        '<div class="social-desc">' + W.esc(l.desc) + '</div>' +
      '</div>' +
      '<div class="social-go">' + W.esc(l.btn) + '</div>';
    grid.appendChild(el);
  });
})();
