/* 羊毛AIHUB · 独立对话页 v2.3
 * 对话逻辑在共享核心 chat-core.js（WOOL.mountChat），本页只负责：
 * 置顶红包条 + 挂载放大简洁版对话 + ?q= 预填
 * 前端统一用「优惠」表述，不出现"返利"。
 */
(function () {
  "use strict";

  var W = window.WOOL;
  var $ = W.$;

  W.buildTopnav("chat");

  /* 置顶红包条 */
  var pinTb = $("pinTb"); if (pinTb) pinTb.addEventListener("click", function () { W.openTbRedpacket(); });
  var pinJd = $("pinJd"); if (pinJd) pinJd.addEventListener("click", function () { W.openJdRedpacket(); });

  /* 放大简洁版对话（与首页共用同一核心） */
  W.mountChat({
    body: "chatBody",
    input: "chatInput",
    send: "chatSend",
    mode: "chatMode",
    prefill: true
  });
})();
