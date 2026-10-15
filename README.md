# 羊毛AIHUB · 找优惠？AI 帮你找！

**在线使用：<https://chenking-maker.github.io/yangmao-aihub/>**

一个全免费的 AI 省钱助手：和 AI 说想买啥，优惠券、红包、凑单一站搞定。
双11 规则越来越复杂，这个网站把找券、领红包、凑满减这些麻烦事全部塞进一个对话框。

创造者：[省钱作业君](about.html)

## 功能

- **AI 找券对话**（`chat.html`，首页也能直接聊）——说需求或直接发淘宝/京东链接，AI 返回带券商品卡、红包入口，并把链接转成你的优惠链接
- **双11 红包入口**——淘宝超级红包、京享红包每天可领，20+ 活动会场一键进入
- **双11 福利清单**——全网折扣好货、大牌捡漏持续更新
- **实时线报广场**（`tipoff.html`）——飞猪旅行 / 淘宝百亿补贴 / 淘宝实时线报 / 京东实时线报 / 宠物线报 / 美妆线报，出现的产品一键转你的优惠链接
- **凑单工具**（`coutao.html`）——粘贴链接或搜关键词添加产品，自动算差额、按「每满200减20」估算可省金额，并推荐刚好补差的商品
- **消灭小红包专区**（`xhd.html`）——9.9 元以下好物，钱包里花不掉的小红包直接抵掉
- **淘金币互动**——双11 淘金币瓜分 20 亿：预约攒能量，最高赚 1188 元抵金
- **好价榜 / 今日秒杀**——9.9 包邮、聚划算、今日上新、0 点过夜单实时更新
- **双11 日历**——付尾款、高潮期、返场等关键节点倒计时
- **微信交流群**（`wechat.html`）——群二维码由站长维护，扫码进群收线报

## 🧩 Skill：/yangmaoaihub

把羊毛AIHUB 装进**微信 / QQ 里的 AI 助手**：实时线报自动推送（**每天最多 50 条**，支持关键词/类目订阅过滤）、双11 红包每日提醒、所有链接自动转专属优惠通道。

安装：在支持 Skill 的 AI 助手对话里发送 `/yangmaoaihub` 即可。详见 [skill/yangmaoaihub/](skill/yangmaoaihub/) 或 [Skill 介绍页](skill.html)。

> 隐私承诺：Skill 永远不索要你的任何平台账号密码；领红包点链接即可，无需登录；订阅设置只保存在你自己设备上。

## 页面结构

```
├── index.html        首页（对话找券 / 红包 / 淘金币互动 / 秒杀 / 好价榜 / 会场 / 日历）
├── chat.html         AI 找券对话（放大简洁版，顶部置顶红包）
├── tipoff.html       实时线报广场
├── collection.html   羊毛集合（红包会场 + 本地生活）
├── coutao.html       凑单工具
├── xhd.html          消灭小红包专区
├── wechat.html       微信交流群（二维码在 qrcodes/ 上传）
├── skill.html        Skill 介绍与安装教程
├── about.html        创作者介绍
├── assets/           样式与脚本（common.js 为跨页面共享层，chat-core.js 为共享对话核心）
├── skill/yangmaoaihub/   /yangmaoaihub Skill 包（SKILL.md + 说明）
└── worker/           Cloudflare Worker（API 代理与 AI 对话中枢）
```

## 本地运行

```bash
# 1. 启动本地 API 代理（端口 8790，负责商品数据与 AI 对话）
cd tools && cp .env.example .env   # 填入你的密钥
NODE_USE_ENV_PROXY=1 node dev-api.mjs

# 2. 启动静态服务（端口 8080，在仓库根目录）
# 任意静态服务器即可，例如：npx serve . -l 8080

# 3. 打开 http://127.0.0.1:8080
```

## 部署

- **前端**：GitHub Pages —— 仓库 Settings → Pages → 选择 `master` 分支 `/(root)` 即可，无需备案
- **后端**：Cloudflare Worker（`worker/` 目录），密钥放在 Worker 环境变量

详细步骤见 [DEPLOY.md](DEPLOY.md)。

## 技术栈

纯静态前端（原生 HTML/CSS/JS，无构建步骤）+ Cloudflare Worker（API 代理与 AI 对话中枢）。

## License

MIT
