# 羊毛AIHUB · 规划书 v2.1

> 2026-10-15 · 省钱作业君(Chenking) · 站点名：**羊毛AIHUB**（YANGMAO AIHUB）
> 目标：双11 前上线，GitHub 公开可见、人人可用、对用户全免费。
> 口号：**找优惠？AI 帮你找！**
> 创造者：省钱作业君
> ⚠️ 品牌铁律：上游渠道（好单库等）前端零暴露，统一称「AI / AI 智能选品引擎」。

## 0. 决策记录

| 决策项 | 选择 |
|--------|------|
| 站点名称 | **羊毛AIHUB**（品牌升级：原「羊毛Hub」；"AI" 点明 AI 找券定位，"HUB"=工具箱集合） |
| 创造者 | **省钱作业君** |
| 口号 | **找优惠？AI 帮你找！** |
| Logo | 小羊(白圆团)+右上金色¥硬币(掉钱感)+黑色圆角矩形内青色「AI」+黄色闪电（装了 AI 的羊毛更省更赚） |
| 设计方向 | v1.2 浅灰清爽 → **v2.0 aruhub playground 灰白极简**（灰底 #f4f5f7 + 白卡 + 1px 细线 + 大圆角 + 红包红 #d93832 强调） |
| 部署 | GitHub Pages 自带域名，**不需要备案** |
| 隐私铁律 | **页面零佣金字样**，只展示优惠券/省钱额/「我的返利链接」；佣金字段在 API 出口剥离（normalizeProduct/normalizeActivity/normalizeWire/convertLink） |
| 品牌铁律 | **上游渠道（好单库等）前端零暴露**；页面/对话/文案统一「AI / AI 智能选品引擎」，系统提示词红线禁提上游平台名 |
| AI 通道 | **硅基流动 Qwen/Qwen2.5-7B-Instruct**（比 GLM-5.3-Flash 快 ~4 倍、工具调用稳；原 GLM 慢 27s 已弃用） |
| 对话安全 | 系统提示词内置话题红线：政治/色情/违法/医疗/投资建议等一律礼貌拒答并拉回找券 |
| 对话助手名 | **羊毛AI · 找券助手**（不叫「小羊找券助手」） |
| 转链归因 | 淘宝：tb_name=chenking陈逸希 已填；商品转链免 tb_name 可用，**红包/会场转链需 tb_name**；京东：JD_UNION_ID=1000559363 已绑，但京东官方授权未开通 → 京东转链降级原始链接+说明 |

## 0.5 v2.0 已完成（2026-10-15）

- **品牌统一**：全站改名「羊毛Hub」（title/favicon/logo/侧栏/页脚/README）
- **按 aruhub playground 重设计**：灰白极简、白卡细线大圆角、双主题
- **侧栏分组**：对话（AI找券对话）/ 红包专区（双11红包入口+活动会场）/ 工具箱（凑单+日历）/ 榜单（今日秒杀+好价榜）
- **首页精简**：顶部双11红包大卡（淘宝+京东）；主体左 AI 对话 + 右今日秒杀竖列表；下方好价榜、活动会场、工具箱
- **AI 对话真对话化**：多轮上下文；聊天气泡（用户右/AI左）；商品卡、红包卡内嵌消息流；红包链接对话里直接发（get_redpacket 工具）
- **后端增强**：`/api/activities`（好单库活动中心 20 个真实活动）、`/api/redpacket`（会场转链，无 tb_name 自动降级）；LLM function calling 三工具（search_goods/get_feed/get_redpacket）
- **硅基流动对接实测通过**：找商品（多轮工具调用收敛）、红包直发、政治敏感拒答，全部 OK
- **踩坑记录**：
  - GLM-5.3-Flash 是混合推理模型，工具调用后答案会落进 `reasoning_content` → 请求必须带 `enable_thinking:false`，并加 reasoning 兜底
  - 沙箱内 Node fetch 不读 HTTP_PROXY → 本地代理需 `NODE_USE_ENV_PROXY=1` 启动（Worker 部署无此问题）
  - 沙箱会回收 `( & )` 后台进程 → 长驻服务要用任务级后台方式启动
  - 8788 端口被本机「产品进化熔炉」占用 → 本地代理固定 **8790**
  - createConference_code 必须传真实 tb_name（授权淘宝昵称），试过空值/任意值均被拒

## 0.6 待办（需要用户）

1. **提供授权淘宝昵称（tb_name）**：好单库后台 publish.haodanku.com/Promotioncenter/auth 查看 → 填 `tools/.env` 的 `HDK_TB_NAME` 和 Worker  secret。填了红包转链才归因到推广位；不填也能领红包（走原始链接）
   ⚠️ 好单库淘宝授权**有效期一个月**，到期要在后台重新授权
2. GitHub 仓库名建议 `yangmao-hub`；Cloudflare Worker 部署后把域名填进 `site/assets/app.js` 的 `API_BASE`
3. 如需自定义域名再走备案（当前 GitHub Pages 域名无需备案）

## 0.7 v2.1 已完成（2026-10-15）

在 v2.0 基础上按 6 项需求改版，全部落地并已 Playwright 实测（零 pageerror）：

1. **品牌升级「羊毛AIHUB」**：全站改名（title/favicon/logo/侧栏/页脚/README/PLAN）；创造者「省钱作业君」；口号「找优惠？AI 帮你找！」上首页 hero；新 Logo（小羊+金色¥硬币掉钱感+黑色圆角矩形内青色「AI」+黄色闪电）。
2. **对话链接转返利**：用户发淘宝/京东链接 → AI 调 `/api/convert` 换成自己的返利链接发回 + 说明有什么券；助手名改「羊毛AI · 找券助手」。
3. **AI 模型提速**：GLM-5.3-Flash（~27s）→ **Qwen/Qwen2.5-7B-Instruct**（~1.5s，快 4 倍，工具调用稳，`enable_thinking:false`）。
4. **数据来源隐藏（品牌铁律）**：前端零「好单库」字样，统一称「AI / AI 智能选品引擎 / AI 实时选品」；系统提示词红线禁提上游平台名；页脚改为「AI 智能选品引擎实时聚合」。
5. **实时线报广场（新页 tipoff.html）**：同步好单库线报/素材社区，7 类目（飞猪旅行/淘宝百亿补贴/淘宝实时线报/京东实时线报/宠物线报/美妆线报/全部）；每条线报的一键「🛒 转链购买 / 🔗 转我的链接」全部换成自己的返利链接。
6. **顶部导航 + 羊毛集合页（新页 collection.html）**：顶部导航 = 🧧 淘宝超级红包小链接 + 首页 / 线报广场 / 羊毛集合 + 主题切换；羊毛集合页放所有可领红包+会场（20 个真实活动），本地生活（美团/饿了么/滴滴/电影票/话费/加油）占位，待对接云瞻助手聚合返利平台。

**技术改动**：`worker/src/core.js` 新增 `hdkWireCategories/normalizeWire/hdkWireReport/hdkMaterialTags/hdkMaterialCommunities/hdkMaterialItems/extractLinkMaterial/convertLink`；`worker/src/index.js` 新增 `/api/wire` `/api/convert` 路由与 `convert_link` 工具；`tools/dev-api.mjs` 镜像新路由（端口 8790）；`site/assets/common.js` 新建 `window.WOOL` 共享层（Logo SVG / 顶部导航 / 红包跳转 / API 封装）；`site/index.html` `tipoff.html` `collection.html` 三页同构。

**踩坑**：线报数据每条是独立对象，`item_id`（淘口令 token）常与文字行相邻、不在文本内 → `tipoff.js` 改遍历 `it.lines`，对 `l.itemId && !l.text` 渲染转链按钮（否则按钮为 0）。

## 0.8 待办（需要用户）

1. **京东官方授权**：好单库后台 `https://publish.haodanku.com/Promotioncenter/auth?platform=2` 开通京东官方账号（JD_UNION_ID=1000559363 已绑，但官方授权未开）→ 开通后京东转链才出返利链接，否则降级原始链接+说明。⚠️ 授权绑定到期 **2026-11-14**，到期前须重新绑定。
2. **云瞻助手对接**：羊毛集合页「本地生活」区需用户登录云瞻助手聚合返利平台账号获取对接凭据后接入（当前 6 个卡为占位「对接中」状态）。
3. GitHub 仓库名建议 `yangmao-aihub`；Cloudflare Worker 部署后把域名填进 `site/assets/common.js` 的 `API_BASE`。

## 0.9 v2.1.1 修订（2026-10-15，5 项反馈）

1. **凑单工具对齐今年规则**：满300-50 已无，今年淘宝以「官方立减」+ 跨店**每满200减20**（上不封顶）为主。默认门槛 300→**200**，结果区加「预计再省 ¥N = floor(门槛/200)×20」；欢迎 chip 改「满200减20怎么凑单」。
2. **前端禁「返利」**：全站（含 SYSTEM_PROMPT / convert_link 工具描述 / convertLink note 等用户可见出口）返利→优惠；普通用户只看到「优惠」，CPS 归因机制仅运营者可见；上游渠道名（好单库/云瞻助手）前端 genericize 为「聚合优惠平台 / AI 智能选品引擎」。
3. **图片/线报"不显示"根因**：本地 8080→8790 实测全好（23 图/15 卡 0 破图）；用户在预览面板/线上占位 URL 下连不到 API，首页静默回退演示图、线报显示"网络开小差"。
4. **修复**：`common.js` 新增 `mountApiBanner()`——连不上 API 时顶部弹醒目提示（本地引导启动 dev-api，线上"服务加载中"），不再静默；`core.js` 图片代理白名单加 `ffquan.(cn|com)`（线报附图）。
5. **部署文档**：新建 `DEPLOY.md`（GitHub 上传 + Pages + Cloudflare Worker 图文步骤）。

---

## 一、这个网站是什么（定位）

一句话：**全免费的双11 找券神器**——用户不花一分钱，用「对话」的方式让 AI 帮他找券、领红包、凑单；站点通过淘宝客 CPS 佣金获得收益（用户领券省钱，站长得佣金，双赢，用户侧零费用）。

**与众不同在哪**：

1. **对话式找羊毛**：不说"货架"，说"跟 AI 说人话"——"想给爸妈买 200 以内的牛奶"直接出结果卡
2. **红包链接对话里直接发**：AI 调转链接口，把可归因的红包/会场链接直接发给用户
3. **Hub 形态**：找券、红包、秒杀、好价榜、凑单、日历，一个站全配齐
4. **灰白 playground 美学**：干净、现代、信息密度舒服，和满屏大红大紫的导购站划清界限

---

## 二、调研结论（已实测）

### 2.1 好单库 haodanku（主数据源）

- **接入**：apikey 鉴权（普通接口）；当前 apikey `piaoyigou` 已验证有效
- **核心接口**（v3.api.haodanku.com）：

| 能力 | 路径 | 状态 |
|------|------|------|
| 淘宝商品搜索 | `/supersearch` | ✅ 有数据，商品自带 couponurl 领券直链 |
| 榜单/频道 | `/column` | ✅ type=1/2/4/6 有数据；5/8 无数据 |
| 商品转链 | `/ratesurl` | ✅ 免 tb_name 可用（归因 PID） |
| 会场转链 | `v2.../createConference_code` | ⚠️ 需真实 tb_name，缺省降级原始链接 |
| 活动列表 | `www.haodanku.com/openapi/activity_list` | ✅ 20 个真实活动（双11超级红包/京享红包/京东主会场…） |

- 京东/拼多多/抖音活动**直接打开原始链接**即可用（转链需另行申请权限，V1 不做）

### 2.2 硅基流动（AI 通道）

- `https://api.siliconflow.cn/v1` · **当前激活模型 `Qwen/Qwen2.5-7B-Instruct`**（~1.5s，工具调用稳，默认）
- ✅ 支持 OpenAI 兼容 function calling；请求需带 `enable_thinking:false`
- 备选：`Qwen/Qwen2.5-14B-Instruct`（质量略高 ~5.5s）、`zai-org/GLM-5.3-Flash`（推理模型，慢 ~27s，已弃用）
- ⚠️ GLM-5.3-Flash 是混合推理模型：必须 `enable_thinking:false`，否则工具调用后答案落入 reasoning_content 导致空回复——这也是当初换 Qwen 的主要原因

---

## 三、技术架构

```
用户浏览器
   │   GitHub Pages（静态站，代码全公开）
   ▼
Cloudflare Worker（免费额度 10 万次/天，密钥保险箱）
   ├── GET  /api/search?q=        → 商品搜索
   ├── GET  /api/feed?type=       → 榜单
   ├── GET  /api/activities       → 活动中心（红包会场）
   ├── POST /api/redpacket        → 会场转链（归因/降级）
   ├── GET  /api/wire?type=&page= → 实时线报（飞猪/百亿补贴/淘宝/京东）
   ├── GET  /api/material?tag=    → 素材社区线报（宠物/美妆）
   ├── POST /api/convert          → 链接/口令转链（淘宝归因 / 京东降级）
   ├── POST /api/chat             → LLM 对话（function calling：search/get_feed/get_redpacket/convert_link）
   ├── POST /api/coupon           → 淘口令
   ├── GET  /api/img?u=           → 图片同源代理
   └── 内存缓存(10min) + 限流(40次/分/IP) + CORS
```

本地开发：`tools/dev-api.mjs`（端口 8790，与 Worker 同构，读 tools/.env）。

---

## 四、功能现状（v2.1）

| 模块 | 状态 |
|------|------|
| AI 找券对话（多轮+工具调用+红包直发+敏感词红线+助手名「羊毛AI·找券助手」） | ✅ |
| **链接转返利**（发淘宝/京东链接 → AI 转自己的返利链接+说明有什么券） | ✅ |
| 顶部导航（🧧超级红包小链接 + 首页/线报广场/羊毛集合 + 主题切换） | ✅ |
| 双11 红包入口（淘宝超级红包/京享红包，真实活动数据） | ✅ |
| 今日秒杀（首页右栏，0点过夜单） | ✅ |
| 好价榜（9.9/聚划算/今日上新） | ✅ |
| 凑单工具（门槛+已选→补差推荐） | ✅ |
| 双11 日历 + 倒计时 | ✅ |
| 活动会场（20 个真实活动） | ✅ |
| **实时线报广场**（飞猪/百亿补贴/淘宝线报/京东线报/宠物/美妆，一键转自己的链接） | ✅ |
| **羊毛集合页**（所有红包+会场 + 本地生活占位待云瞻助手对接） | ✅ |
| 佣金字段出口剥离 + 文案零佣金 + 上游渠道前端零暴露（品牌铁律） | ✅ |

### 后续

- 用户系统：收藏、关键词到货提醒
- 京东官方授权开通后启用京东返利转链（当前降级）
- 云瞻助手对接后上线本地生活（美团/饿了么/滴滴/电影票/话费/加油）返利
- 浏览器插件「一键查券」
- 站方收益看板

---

## 五、设计系统（aruhub playground 灰白极简）

- **底色** `#f4f5f7` 灰白 · **卡片** 纯白 + 1px `#e8eaee` 细线 + 大圆角（12-20px）+ 悬浮微抬升
- **强调色**：双11 红包红 `#d93832`（按钮/价格/券标/高亮）；京东金 `#b8862d`（京东卡片）
- **字体**：系统 sans + 等宽 mono（价格/日期/数据标签）
- **主题**：浅色默认，深色可切换（localStorage 记忆）
- **布局**：220px 分组侧栏 + 主区（红包大卡 → 对话+秒杀两栏 → 好价榜 → 活动会场 → 工具箱）

---

## 六、部署步骤

1. **GitHub Pages**：仓库 `yangmao-hub` → Settings → Pages → main 分支根目录（无需备案）
2. **Cloudflare Worker**：`cd worker && npx wrangler secret put HDK_APIKEY/HDK_PID/HDK_TB_NAME/LLM_API_KEY/LLM_BASE_URL/LLM_MODEL && npx wrangler deploy`
3. **联通**：Worker 域名填进 `site/assets/app.js` 的 `API_BASE`（替换 wool-ai-api.workers.dev）
4. **验证**：`GET /api/health` 应返回 `hasKey:true, hasLLM:true`

---

## 七、风险与注意

1. **好单库淘宝授权一个月有效期**——到期重新授权，否则转链失败（已做降级：失败自动用原始链接）
2. **tb_name 缺失时红包不归因**（用户仍能领券，站点损失佣金归因）——优先推动用户提供昵称
3. API 密钥绝不进 Git（.gitignore + Worker 环境变量双保险）
4. LLM 提示词红线是软约束，极端情况可能被绕过——页面保留「仅导购」定位，不承诺绝对安全
5. 好单库接口有频率限制，Worker 已做 10 分钟缓存 + 每 IP 40 次/分限流
6. 返利类站点文案守淘宝联盟规范：不价格误导、不仿冒官方
