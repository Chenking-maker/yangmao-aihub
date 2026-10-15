# 羊毛AIHUB · 找优惠？AI帮你找！

全免费的省钱助手：**和 AI 说想买啥，优惠券、红包、凑单一站搞定；发淘宝/京东链接，AI 直接转成你自己的优惠链接并发回**。
用户零费用；站点收入 = 淘宝客 CPS 佣金（你领券省钱，平台付佣金，双赢）。
**页面上只出现「优惠券 / 优惠链接」，佣金信息在任何出口都已被剥离**（见下方隐私铁律）。
**品牌红线：前端不出现「返利 / 佣金 / 归因 / 上游渠道名」，对普通用户统一只说「优惠」**（内部 CPS 归因机制见文末运维说明，仅运营者可见）。
**数据来源统一对外称「AI 智能选品引擎」，不暴露好单库等上游渠道名**（见下方品牌铁律）。

- 前端：纯静态（无构建步骤）→ GitHub Pages
- 后端：Cloudflare Worker（免费额度）→ 藏密钥、缓存、限流、AI 对话中枢
- 数据：好单库开放平台（商品搜索 / 榜单 / 活动会场 / 转链 / 线报 / 素材社区）— 前端一律称「AI」
- AI：硅基流动 **Qwen/Qwen2.5-7B-Instruct**（比 GLM-5.3-Flash 快约 4 倍，工具调用稳定）
- 设计：aruhub playground 灰白极简风 + 双11 红包红强调，浅/深双主题

## 品牌

| 项 | 值 |
|----|----|
| 站点名 | **羊毛AIHUB** |
| 创造者 | 省钱作业君 |
| 口号 | 找优惠？AI 帮你找！ |
| Logo | 小羊（白圆团）+ 右上金色 ¥ 硬币（掉钱感）+ 黑色圆角矩形内青色「AI」+ 黄色闪电（寓意：装了 AI 的羊毛更省钱更赚钱） |
| 对话助手名 | **羊毛AI · 找券助手**（不叫「小羊找券助手」） |

## 功能

| 模块 | 说明 |
|------|------|
| AI 找券对话 | 多轮对话，说需求就搜带券商品；可直接要红包链接 |
| **链接转优惠** | 用户发淘宝/京东商品链接 → AI 调转链接口换成自己的优惠链接发回，并说明有什么券 |
| 顶部导航 | 🧧 淘宝超级红包小链接 + 首页 / 线报广场 / 羊毛集合 + 主题切换 |
| 双11 红包入口 | 淘宝超级红包 / 京享红包，一键跳转（走转链归因） |
| 今日秒杀 | 0 点过夜单，首页右栏实时刷新 |
| 好价榜 | 9.9 包邮 / 聚划算 / 今日上新，10 分钟缓存 |
| 凑单工具 | 输入门槛+已选金额，自动推荐补差商品（今年主流每满200减20，默认门槛 200） |
| 双11 日历 | 全周期节点 + 倒计时 |
| 活动会场 | 好单库活动中心实时同步 |
| **实时线报广场** | 飞猪旅行 / 淘宝百亿补贴 / 淘宝实时线报 / 京东实时线报 / 宠物线报 / 美妆线报，全部一键转自己的链接 |
| **羊毛集合页** | 所有可领红包 + 会场；本地生活（美团/饿了么/滴滴/电影票/话费/加油）占位，对接云瞻助手聚合返利平台后上线 |

对话安全：系统提示词内置话题红线（政治/色情/违法/医疗/投资建议等一律礼貌拒答并拉回找券）。

## 目录

```
site/            前端（GitHub Pages 根目录）
  index.html     首页：顶部导航 / 红包入口 / AI 对话 / 秒杀 / 好价榜 / 活动会场 / 工具箱
  tipoff.html    实时线报广场（7 类目：飞猪/百亿补贴/淘宝线报/京东线报/宠物/美妆）
  collection.html 羊毛集合（所有红包+会场 + 本地生活占位）
  assets/
    common.js    window.WOOL 共享层：API / toast / Logo SVG / 顶部导航渲染 / 红包跳转
    style.css    设计系统
    data.js      演示兜底数据
    app.js       首页交互（对话 / 转链卡 / 红包 / 榜单）
    tipoff.js    线报广场交互（分类 tab + 转链按钮）
    collection.js 羊毛集合交互（红包区 + 本地生活区）
worker/          Cloudflare Worker
  src/index.js   /api/search /api/feed /api/activities /api/redpacket /api/chat /api/coupon /api/img /api/wire /api/convert
  src/core.js    共享核心：数据规范化 + 佣金字段剥离（铁律）+ 线报/素材 + 转链归因
tools/
  dev-api.mjs    本地开发代理（与 Worker 同构，端口 8790）
  .env           本地密钥（不进 Git，复制 .env.example 填写）
research/        调研资料（好单库 API 文档）
PLAN.md          完整规划书
```

## 本地预览（真实数据）

需要起两个服务（静态页 + API 代理）：

```bash
# 终端 1：静态页
cd site && python -m http.server 8080 --bind 127.0.0.1

# 终端 2：API 代理（读 tools/.env 里的 apikey，端口 8790）
NODE_USE_ENV_PROXY=1 node tools/dev-api.mjs
```

打开 http://127.0.0.1:8080 —— 页面会自动连 127.0.0.1:8790 拉真实商品/线报数据。

> 注：若在需要代理的网络环境下运行，Node 的 fetch 不读 `HTTP_PROXY` 环境变量，
> 请加 `NODE_USE_ENV_PROXY=1` 启动（如上）。部署到 Cloudflare Worker 无此问题（Worker 直连外网）。

## 部署

> 📖 **一步步图文教程见 [`DEPLOY.md`](./DEPLOY.md)**（含 Git 安装、建仓库、推送、开 Pages、部署 Worker、填 API_BASE，适合第一次上手）。下面是命令速查。

**1. 前端 → GitHub Pages**
```bash
git add . && git commit -m "init"
git branch -M main
git remote add origin https://github.com/<你的用户名>/yangmao-aihub.git
git push -u origin main
# GitHub 仓库 Settings → Pages → Source 选 main 分支 /(root)
```

**2. 后端 → Cloudflare Worker**
```bash
cd worker
npx wrangler secret put HDK_APIKEY
npx wrangler secret put HDK_PID
npx wrangler secret put HDK_TB_NAME      # 淘宝昵称（淘宝授权后生效，决定返利归因）
npx wrangler secret put JD_UNION_ID      # 京东联盟ID（京东官方授权后生效）
npx wrangler secret put JD_AUTH_KEY      # 京东授权KEY
npx wrangler secret put JD_AUTH_EXPIRE   # 授权到期时间
npx wrangler secret put LLM_API_KEY
npx wrangler secret put LLM_BASE_URL     # https://api.siliconflow.cn/v1
npx wrangler secret put LLM_MODEL        # Qwen/Qwen2.5-7B-Instruct
npx wrangler deploy
```

**3. 联通前后端**：把 Worker 域名填进 `site/assets/common.js` 顶部的 `API_BASE`（替换 `http://127.0.0.1:8790`）。

## 授权信息（运维用，站点前端不展示）

| 项 | 值 | 备注 |
|----|----|------|
| 淘宝昵称 (HDK_TB_NAME) | `chenking陈逸希` | 好单库后台淘宝授权昵称 |
| 京东联盟ID (JD_UNION_ID) | `1000559363` | 已绑定 |
| 京东授权 KEY | `E4209EAC...` | 后台 auth?platform=2 查看 |
| 京东授权到期 | `2027-06-02` |  |
| 授权绑定到期 | `2026-11-14` | ⚠️ 到期前需重新绑定，否则京东转链失效 |
| 后台地址 | https://publish.haodanku.com/Promotioncenter/auth?platform=2 | 淘宝/京东授权管理 |

> ⚠️ **两件事需用户处理**：
> 1. **京东官方授权**：JD_AUTH 需在好单库后台 `platform=2` 开通京东官方账号（当前未开通 → 京东转链自动降级为原始链接 + 说明，不影响用户领券）。
> 2. **云瞻助手对接**：羊毛集合页的「本地生活」（美团/饿了么/滴滴/电影票/话费/加油）需用户登录云瞻助手聚合返利平台账号后对接，当前为占位状态。

## 接口清单（Worker / 本地代理同构）

| 路由 | 用途 |
|------|------|
| GET /api/health | 探活：是否配了 apikey / LLM / 京东授权 |
| GET /api/search?q= | 商品搜索（带券商品） |
| GET /api/feed?type= | 榜单：1=今日上新 2=9.9包邮 4=聚划算 6=0点秒杀 |
| GET /api/activities | 双11 活动/红包会场列表（活动中心） |
| POST /api/redpacket | 会场转链（红包归因链接；无 tb_name 时降级原始链接） |
| GET /api/img?u= | 淘宝图片同源代理（防盗链） |
| POST /api/coupon | 生成淘口令（需淘宝授权） |
| GET /api/wire?type=&page= | 实时线报（飞猪/百亿补贴/淘宝/京东 四类目） |
| GET /api/material?tag= | 素材社区线报（宠物/美妆 等分类） |
| POST /api/convert | 链接/口令转链：淘宝→自己的优惠链接（带 tb_name 归因，内部机制）；京东→（授权后）优惠链接，未授权降级原始链接 |
| POST /api/chat | LLM 对话（function calling：search_goods / get_feed / get_redpacket / convert_link） |

**隐私铁律**：`core.js` 的 `normalizeProduct` / `normalizeActivity` / `normalizeWire` / `convertLink` 在出口处剥离佣金字段（tkrates/tkmoney/commission_rate），前端永远拿不到，页面上也不出现任何佣金字样——对用户只展示优惠券、省钱额和「我的优惠链接」。转链的 CPS 归因（PID/tb_name）是站方内部收益机制，仅运营者可见，前端零暴露。

**品牌铁律**：上游数据渠道（好单库等）一律不在前端出现。页面、对话、文案统一用「AI / AI 智能选品引擎 / AI 实时选品」等表述；系统提示词内置红线禁止提及任何上游平台名。

## License

MIT
