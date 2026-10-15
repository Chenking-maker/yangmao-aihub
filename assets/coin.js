/* 羊毛AIHUB · 淘金币互助活动页
 * 双11 瓜分20亿 · 提前攒能量最高赚1188抵金
 * 链接/淘口令由站方配置；10月18日开启后在此页追加每日任务攻略。
 */
(function () {
  "use strict";

  var W = window.WOOL;
  var $ = W.$;

  W.buildTopnav("");

  var COIN_URL = "https://m.tb.cn/h.jYavG0k";
  var COIN_TAO = "17💲N9pITHyybzL£ https://m.tb.cn/h.jYavG0k CA381";

  var go = $("coinGo");
  if (go) go.addEventListener("click", function () {
    W.toast("正在打开淘金币活动…");
    window.open(COIN_URL, "_blank", "noopener");
  });
  var copy = $("coinCopy");
  if (copy) copy.addEventListener("click", function () {
    W.copyText(COIN_TAO, "淘口令已复制，打开淘宝自动识别");
  });
})();
