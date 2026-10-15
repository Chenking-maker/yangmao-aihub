# 羊毛AIHUB · 找优惠？AI帮你找！

> 双11 AI 找券助手 · 对话找优惠券 · 双11红包每日领 · 实时线报推送 · 凑单计算 · 淘金币互助
> **在线使用（免安装、全免费）**：**https://chenking-maker.github.io/yangmao-aihub/**

![双11](https://img.shields.io/badge/双11-2026-red) ![AI找券](https://img.shields.io/badge/AI-对话找券-5e6ad2) ![免费](https://img.shields.io/badge/价格-永久免费-success) ![开源](https://img.shields.io/badge/License-MIT-blue)

**羊毛AIHUB** 是一个面向普通消费者的 **AI 省钱助手网站**：把「找优惠券、领双11红包、算凑单、看线报、淘金币攒能量」这些复杂事全部装进一个对话框和一个网页工具箱。**对用户永久免费、无需注册、不用下载 APP**。

---

## ✨ 核心功能

| 功能 | 说明 |
|------|------|
| 🐑 **AI 找券对话** | 说「给爸妈买纯牛奶」「9.9 包邮有什么」，AI 自动搜出真实商品+隐藏优惠券；发淘宝/京东链接还能直接转成专属优惠链接 |
| 🧧 **双11 红包** | 淘宝超级红包、京东京享红包，每天可领，一键直达；还有持续更新的双11福利清单 |
| 📡 **实时线报广场** | 飞猪旅行 / 淘宝百亿补贴 / 淘宝线报 / 京东线报 / 宠物线报 / 美妆线报，六类线报实时滚动，商品一键转优惠链接 |
| 🧮 **凑单工具** | 输入你的产品自动算差额，按「每满200减20」智能推荐刚好补差的商品 |
| 🧨 **消灭小红包** | 9.9 元以下好物专区，钱包里的小红包直接抵掉 |
| 💰 **淘金币互助** | 双11 淘金币瓜分 20 亿：预约攒能量攻略、每日任务清单（10月18日开启后持续更新） |
| 📅 **双11 日历** | 付尾款、高潮期、返场，全周期节奏一张表 + 实时倒计时 |
| ⚡ **/yangmaoaihub Skill** | 装进微信/QQ 的 AI 助手技能：实时线报自动推送（每天最多 50 条）、关键词/类目订阅、红包每日提醒 |
| 💬 **羊毛交流群** | 微信群二维码页，线报群里天天发 |

## 🚀 快速开始

1. **直接用**：打开 **https://chenking-maker.github.io/yangmao-aihub/** → 跟 AI 说想买什么
2. **微信/QQ 里用**：见 [Skill 介绍页](https://chenking-maker.github.io/yangmao-aihub/skill.html)，输入 `/yangmaoaihub` 安装
3. **自部署**：见 [DEPLOY.md](DEPLOY.md)（GitHub Pages + Cloudflare Worker，全免费额度即可跑）；后端详细图文教程见 [WORKER-DEPLOY.md](WORKER-DEPLOY.md)

## 📚 深入了解（Wiki）

- [双11 红包攻略](../../wiki/双11红包攻略) —— 超级红包 / 京享红包怎么领最划算
- [淘金币互助攻略](../../wiki/淘金币互助攻略) —— 瓜分 20 亿：攒能量全流程
- [Skill 使用教程](../../wiki/Skill使用教程) —— /yangmaoaihub 微信/QQ 安装与订阅
- [凑单攻略](../../wiki/凑单攻略) —— 每满200减20 怎么凑最省
- [常见问题 FAQ](../../wiki/FAQ)

## 🗂 项目结构

```
├─ index.html          首页（对话找券 + 红包 + 好价榜 + 淘金币 + 日历）
├─ chat.html           AI 找券对话（全屏版）
├─ tipoff.html         实时线报广场
├─ coutao.html         凑单工具
├─ xhd.html            消灭小红包专区
├─ coin.html           淘金币互助（双11 瓜分20亿）
├─ collection.html     羊毛集合（红包/会场/本地生活）
├─ wechat.html         微信交流群
├─ skill.html          /yangmaoaihub Skill 介绍与教程
├─ about.html          羊毛AIHUB 介绍
├─ skill/yangmaoaihub/ Skill 包（SKILL.md + 安装说明）
├─ worker/             Cloudflare Worker 后端（API 代理 + AI 对话）
└─ assets/             前端样式与脚本
```

## 🏷 关键词

`双11` `双11红包` `超级红包` `京享红包` `优惠券` `隐藏券` `薅羊毛` `线报` `实时线报` `好价` `低价` `捡漏` `凑单` `跨店满减` `每满200减20` `淘金币` `瓜分20亿` `攒能量` `AI找券` `AI助手` `省钱` `购物` `淘宝` `京东` `9.9包邮` `折扣` `skill` `微信` `QQ`

## 🤝 参与

- 有问题 / 建议 → [提 Issue](../../issues)
- 想改代码 → 直接 PR
- 觉得有用 → 点个 ⭐ Star 让更多人看到

---

**羊毛AIHUB** · 创造者 **省钱作业君**（微博 / 小红书 / 微信同名）· MIT License
