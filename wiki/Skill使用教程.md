# /yangmaoaihub Skill 使用教程（微信 ClawBot / WorkBuddy / 其他 AI 助手）

> 把羊毛AIHUB 装进你的 AI 助手，发一句命令就能用，不用开网页。

## 它能做什么

| 功能 | 说明 |
|------|------|
| 📡 **实时线报推送** | 六大类目（淘宝/京东/飞猪/百亿补贴/宠物/美妆）实时监控，有新货直接推给你，**每天最多 50 条**（默认 20，可自定） |
| 🔑 **关键词 / 类目订阅** | 「订阅纸巾和狗粮」「只推淘宝线报」，只发你关心的 |
| 🔗 **优惠链接直达** | 推出来的口令和链接，全部已转好，点开就能领券下单 |
| 🧧 **红包每日提醒** | 定时提醒领双11 红包，一键直达，绝不漏领 |

## 安装步骤

### 路径一：微信 ClawBot（推荐，微信里直接聊）

目前唯一能在微信聊天窗口直接调用 Skill 的官方通道：

1. 电脑安装 **QClaw**（qclaw.qq.com，已部署 OpenClaw 可跳过）
2. 微信 → 我 → 设置 → **插件** → 找到 **ClawBot** → 启用（灰度中，看不到就升级微信到 8.0.70+ 重开）
3. 插件页「详细」里复制安装命令，在电脑终端执行：
   `npx -y @tencent-weixin/openclaw-weixin-cli@latest install`
4. 终端弹出二维码 → 微信扫码授权 → 微信联系人出现「微信ClawBot」
5. 在微信 ClawBot 聊天窗直接发：**「安装 yangmaoaihub」**
   - 若回复没找到该技能，在电脑终端补一条：
     `npx --yes skills add https://github.com/Chenking-maker/yangmao-aihub/tree/master/skill/yangmaoaihub -a openclaw -y`

### 路径二：WorkBuddy（能力最全）

在 WorkBuddy 对话框发送 **`/yangmaoaihub`**，按提示确认安装。

### 路径三：任意 AI 助手（元宝 / DeepSeek / 豆包 / Kimi…）

把这条消息发给任意 AI 助手，它会按 Skill 说明帮你整理线报和红包提醒：
`安装羊毛AIHUB Skill：https://github.com/Chenking-maker/yangmao-aihub/tree/master/skill/yangmaoaihub`

> ⚠️ 元宝、ima 暂不支持第三方 Skill 安装（元宝加好友后也会回复"用不了"）。想在微信里直接用，请走路径一 ClawBot。

## 装好之后：常用指令示例

```
订阅纸巾、狗粮、纯牛奶              # 设置关键词订阅
只推淘宝线报                        # 只看某个类目
每天最多推 50 条                    # 调整推送上限
今天有什么红包                      # 手动触发红包提醒
```

## 隐私说明

- Skill **不需要也不存储**你的淘宝/京东账号密码
- 领红包不需要密码：推送的链接点开即达官方页面
- 请勿向任何人（包括 AI 助手）提供账号密码、验证码

---
相关页面：[[Home]] · [[双11红包攻略]] · [[FAQ]]
