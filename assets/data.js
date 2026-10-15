/* 羊毛Hub 数据 — 演示兜底数据 + 活动清单 + 双11 日历
 * 接口联通后由 /api/feed、/api/search、/api/activities 实时替换；此文件仅离线兜底
 * 注意：不含任何佣金字段（前端不展示佣金）
 */
window.WOOL_DEMO = true;

window.PRODUCTS = [
  { id: "d001", tag: "9.9", icon: "🥛", title: "金典纯牛奶 250ml×12 整箱装 旗舰店", shop: "伊利旗舰店", sales: 12847, price: 69, endPrice: 39.9, coupon: 29, taoword: "¥demo01¥" },
  { id: "d002", tag: "9.9", icon: "🧻", title: "原木纯品抽纸 30包 家用整箱批发", shop: "洁柔居家专卖", sales: 52310, price: 24.9, endPrice: 9.9, coupon: 15, taoword: "¥demo02¥" },
  { id: "d003", tag: "9.9", icon: "🍫", title: "德芙巧克力礼盒装 520g 零食大礼包", shop: "德芙官方店", sales: 8932, price: 59.9, endPrice: 19.9, coupon: 40, taoword: "¥demo03¥" },
  { id: "d004", tag: "juhuasuan", icon: "👟", title: "回力男鞋秋季透气板鞋 男女同款", shop: "回力旗舰店", sales: 34120, price: 139, endPrice: 69, coupon: 70, taoword: "¥demo04¥" },
  { id: "d005", tag: "juhuasuan", icon: "🧥", title: "轻薄羽绒服 秋冬新款 多色可选", shop: "风尚男装旗舰", sales: 15680, price: 499, endPrice: 199, coupon: 300, taoword: "¥demo05¥" },
  { id: "d006", tag: "juhuasuan", icon: "🎧", title: "蓝牙耳机真无线 降噪超长续航", shop: "数码电子城", sales: 27650, price: 199, endPrice: 59, coupon: 140, taoword: "¥demo06¥" },
  { id: "d007", tag: "brand", icon: "🧴", title: "护肤精华 50ml 正装套装 清爽不黏腻", shop: "美妆旗舰店", sales: 9840, price: 329, endPrice: 169, coupon: 160, taoword: "¥demo07¥" },
  { id: "d008", tag: "brand", icon: "🍵", title: "精品挂耳咖啡 混合装 24包 送礼自饮", shop: "咖啡旗舰店", sales: 6120, price: 168, endPrice: 89, coupon: 79, taoword: "¥demo08¥" },
  { id: "d009", tag: "hot", icon: "🍜", title: "大骨面整箱 24袋 泡面速食囤货装", shop: "食品旗舰店", sales: 89430, price: 49.9, endPrice: 24.9, coupon: 25, taoword: "¥demo09¥" },
  { id: "d010", tag: "hot", icon: "🧴", title: "婴儿湿巾 80抽×10包 手口可用", shop: "母婴官方店", sales: 45210, price: 79, endPrice: 39, coupon: 40, taoword: "¥demo10¥" },
  { id: "d011", tag: "hot", icon: "🪥", title: "电动牙刷 声波充电式 送4刷头", shop: "个护健康店", sales: 33980, price: 159, endPrice: 49, coupon: 110, taoword: "¥demo11¥" },
  { id: "d012", tag: "seckill", icon: "🧦", title: "纯棉短袜 男女通用 10双装", shop: "袜业工厂店", sales: 19870, price: 39, endPrice: 12.9, coupon: 26, taoword: "¥demo12¥" }
];

/* 活动入口（来源：好单库活动中心） */
window.ACTIVITIES = [
  { name: "双11超级红包", platform: "淘宝", time: "09.29 - 11.14", desc: "双11 超级红包会场，每天可领，下单直接抵现", hot: true },
  { name: "11.11 京享红包", platform: "京东", time: "10.12 - 11.14", desc: "京东双11 京享红包，全品类通用", hot: true },
  { name: "京东双11主会场", platform: "京东", time: "10.12 - 11.15", desc: "京东双11 主会场入口，大牌低价", hot: true },
  { name: "天天领红包", platform: "淘宝", time: "长期", desc: "全场景通用红包，每天都能领", hot: false },
  { name: "1元好礼", platform: "淘宝", time: "09.23 - 11.13", desc: "1 元购好物专场，新客专享", hot: false },
  { name: "抖音商城双11好物节", platform: "抖音", time: "10.13 - 11.11", desc: "抖音电商双11 好物节会场", hot: false },
  { name: "抖音电商超级补贴", platform: "抖音", time: "10.13 起", desc: "超级补贴限时享，官方直补", hot: false },
  { name: "美团外卖节", platform: "美团", time: "长期", desc: "外卖红包节，天天有券", hot: false },
  { name: "吃喝玩乐每日福利", platform: "美团", time: "长期", desc: "到店餐饮、休闲娱乐优惠", hot: false },
  { name: "甄选好店优惠专享", platform: "淘宝", time: "长期", desc: "精选好店专属优惠", hot: false },
  { name: "闪购品牌日", platform: "闪购", time: "长期", desc: "闪购品牌日，单单有福利", hot: false },
  { name: "淘宝闪购", platform: "淘宝", time: "长期", desc: "淘宝闪购频道入口", hot: false },
  { name: "淘票票", platform: "淘票票", time: "长期", desc: "电影票优惠入口", hot: false },
  { name: "88VIP开通奖励", platform: "淘宝", time: "长期", desc: "88VIP 开通享奖励", hot: false },
  { name: "闪购学生专属福利", platform: "闪购", time: "长期", desc: "学生专属福利通道", hot: false },
  { name: "来闪购一下赢免单", platform: "闪购", time: "长期", desc: "闪购免单福利活动", hot: false }
];

/* 双11 日历 */
window.CALENDAR = [
  { date: "10.15 - 10.31", name: "预售付定金", desc: "定金膨胀，锁价双11", state: "past" },
  { date: "11.01 00:00", name: "付尾款", desc: "前 N 名免单，尾款半价", state: "active" },
  { date: "11.01 - 11.10", name: "品类日轮动", desc: "每天一个品类主场", state: "" },
  { date: "11.10 20:00", name: "高潮期", desc: "超级红包雨，跨店满减", state: "" },
  { date: "11.12 - 11.13", name: "返场捡漏", desc: "补货返场，最后低价", state: "" }
];
