/* 羊毛AIHUB · 省钱日报 v1.0
 * 两块数据：
 *  ① 我的省钱账 —— 浏览器本地埋点（common.js 的 WOOL.saveStats），不上传；
 *  ② 全站今日优惠盘点 —— /api/daily（服务端每天定时汇总，缓存 1 小时）。
 */
(function () {
  "use strict";
  var W = window.WOOL;
  var $ = W.$;
  W.buildTopnav("daily");

  function yuan(n) {
    n = Number(n) || 0;
    return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, "") + " 万" : n.toFixed(n % 1 ? 1 : 0);
  }
  function mmdd(d) {
    var p = String(d || "").split("-");
    return p.length === 3 ? (+p[1]) + "/" + (+p[2]) : d;
  }

  /* ---------------- 顶部日期 ---------------- */
  function paintDate() {
    var now = new Date();
    var d = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
    var wd = "日一二三四五六"[d.getDay()];
    $("dailyDate").textContent = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0") + " 周" + wd;
  }

  /* ---------------- 我的省钱账（本地） ---------------- */
  function paintMine() {
    var s = W.saveStats();
    $("mineToday").textContent = yuan(s.today.save);
    $("mineYest").textContent = "¥" + yuan(s.yesterday.save);
    $("mineTotal").textContent = "¥" + yuan(s.total);
    $("mineCount").textContent = s.count;

    var sub = $("mineTodaySub");
    if (s.today.count > 0) sub.innerHTML = "今天点开了 <b>" + s.today.count + "</b> 个优惠，预计省下 ¥" + yuan(s.today.save);
    else sub.innerHTML = '今天还没点开好价，去 <a href="index.html#feed">好价榜</a> 或 <a href="tipoff.html">线报广场</a> 逛逛 ›';

    var tip = $("mineTip");
    if (s.count === 0) {
      tip.innerHTML = "小提示：在任意页面点「领券购买 / 获取优惠链接」，这里就会自动记一笔 —— 记录只存在你这台设备上。";
    } else if (s.yesterday.count > 0) {
      tip.innerHTML = "昨天你点开了 <b>" + s.yesterday.count + "</b> 个好价，预计省下 <b>¥" + yuan(s.yesterday.save) + "</b>。" +
        (s.today.save >= s.yesterday.save ? "今天已经超过昨天啦 👏" : "今天再逛两条，就能超过昨天～");
    } else {
      tip.innerHTML = "昨天没有记录。今天动动手指，明天这份日报就有内容啦。";
    }

    /* 近 7 天柱状图（纯 CSS，不引库） */
    var week = s.week.slice().reverse();   // 从 7 天前排到今天
    var max = Math.max.apply(null, week.map(function (d) { return d.save; }).concat([1]));
    var chart = $("dailyChart");
    chart.innerHTML = "";
    week.forEach(function (d) {
      var h = Math.max(3, Math.round((d.save / max) * 100));
      var col = document.createElement("div");
      col.className = "chart-col";
      col.innerHTML =
        '<div class="chart-val">' + (d.save > 0 ? "¥" + yuan(d.save) : "") + '</div>' +
        '<div class="chart-bar-wrap"><div class="chart-bar" style="height:' + h + '%"></div></div>' +
        '<div class="chart-day">' + mmdd(d.d) + '</div>';
      col.title = d.d + "：省 ¥" + yuan(d.save) + "（" + d.count + " 件）";
      chart.appendChild(col);
    });
  }

  /* ---------------- 全站今日优惠盘点（服务端） ---------------- */
  function paintSite(d) {
    $("dailyScopeTag").textContent = "实时同步 · 更新于 " + new Date(d.generatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    var cards = [
      { k: "在架优惠", v: d.deals, u: "件", s: "AI 正在带货的全部好价" },
      { k: "带券商品", v: d.couponDeals, u: "件", s: "有隐藏券可以领" },
      { k: "券额合计", v: "¥" + yuan(d.couponSave), u: "", s: "这些券加起来的面额", hi: true },
      { k: "到手立省", v: "¥" + yuan(d.instantSave), u: "", s: "按券后价算，一共能省这么多", hi: true }
    ];
    var box = $("dailyCards");
    box.innerHTML = "";
    cards.forEach(function (c) {
      var el = document.createElement("div");
      el.className = "daily-card" + (c.hi ? " hi" : "");
      el.innerHTML = '<div class="dc-k">' + c.k + '</div><div class="dc-v">' + c.v +
        (c.u ? '<span class="dc-u">' + c.u + '</span>' : "") + '</div><div class="dc-s">' + c.s + '</div>';
      box.appendChild(el);
    });
    var extra = document.createElement("div");
    extra.className = "daily-card wide";
    extra.innerHTML = '<div class="dc-k">线报 & 会场</div>' +
      '<div class="dc-v">' + d.wires + '<span class="dc-u">条线报</span></div>' +
      '<div class="dc-s">最近 24 小时；另有 ' + d.activities + ' 个红包/活动会场可领，其中 <b>' + d.rebateActivities + '</b> 个走你的专属优惠通道</div>';
    box.appendChild(extra);

    /* TOP 榜 */
    var top = $("dailyTop");
    top.innerHTML = "";
    if (!d.top || !d.top.length) { top.innerHTML = '<div class="empty-note">暂时取不到榜单，稍后再刷新</div>'; return; }
    d.top.forEach(function (t, i) {
      var el = document.createElement("div");
      el.className = "top-row";
      var thumb = t.pic
        ? '<img class="d-img" loading="lazy" width="42" height="42" src="' + W.imgThumb(t.pic, 96) + '" data-orig="' + W.esc(t.pic) + '" referrerpolicy="no-referrer" alt="">'
        : '<span class="top-ph">' + (i + 1) + '</span>';
      el.innerHTML =
        '<span class="top-rank r' + (i + 1) + '">' + (i + 1) + '</span>' +
        '<span class="top-thumb">' + thumb + '</span>' +
        '<span class="top-body">' +
          '<span class="top-title">' + W.esc(String(t.title || "").slice(0, 46)) + '</span>' +
          '<span class="top-price">券后 ¥' + t.endPrice + (Number(t.price) > 0 ? ' <s>¥' + t.price + '</s>' : '') + '</span>' +
        '</span>' +
        '<span class="top-save">省 ¥' + t.off + '</span>';
      el.addEventListener("click", function () {
        W.logSave({ k: "d:" + t.id, title: t.title, save: t.off });
        W.openCoupon({ id: t.id, title: t.title, price: t.price, endPrice: t.endPrice, coupon: t.coupon });
      });
      top.appendChild(el);
      el.querySelectorAll("img.d-img").forEach(function (img) {
        W.bindImgFallback(img, img.getAttribute("data-orig") || "", img.parentNode, "");
      });
    });
  }

  function loadSite() {
    W.apiGet("/api/daily").then(function (d) {
      if (d && d.deals !== undefined) paintSite(d);
      else $("dailyCards").innerHTML = '<div class="empty-note">日报生成中，稍后刷新看看</div>';
    }).catch(function () {
      $("dailyCards").innerHTML = '<div class="empty-note">网络开小差了，点右上角刷新试试</div>';
    });
  }

  $("dailyRefresh").addEventListener("click", function () {
    paintMine();
    loadSite();
    W.toast("已刷新");
  });

  paintDate();
  paintMine();
  loadSite();
})();
