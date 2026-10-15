# Cloudflare Worker 后端部署 · 一步步图文教程

> 目标：把 `worker/` 目录的 API 服务部署到你在 Cloudflare 创建好的 Worker 服务（`yangmao-aihub`）上，让网站有真实商品/线报/对话数据。
> 全程约 10 分钟，免费额度足够个人站点使用。

---

## 第 0 步 · 准备：一个终端

推荐 **Windows PowerShell** 或 **Git Bash**（你机器上都有）。
本文所有命令都在**项目根目录** `D:\Workbuddy\羊毛网站` 下执行。

先确认 Node 能用（你机器已装）：

```bash
node -v
```

能显示 `v20` / `v22` 之类的版本号就行。

---

## 第 1 步 · 登录 Cloudflare（只需一次）

```bash
cd /d/Workbuddy/羊毛网站/worker
npx wrangler login
```

会弹出浏览器 → 点 **Allow** 授权。看到 `Successfully logged in` 即可。
（若公司/共享电脑不想开浏览器登录，可在 Cloudflare 面板 → My Profile → API Tokens 创建 "Edit Cloudflare Workers" 模板 Token，然后用 `npx wrangler config` 输入。）

---

## 第 2 步 · 确认配置（已帮你改好）

`worker/wrangler.toml` 已经和你创建的服务名对齐：

```toml
name = "yangmao-aihub"      # ← 你在 Cloudflare 建的服务名
main = "src/index.js"
```

> 如果你在 Cloudflare 面板里建的服务名不是 `yangmao-aihub`，就把这里改成你的服务名。

---

## 第 3 步 · 设置密钥（8 个，粘一次值按一次回车）

```bash
cd /d/Workbuddy/羊毛网站/worker

npx wrangler secret put HDK_APIKEY      # 好单库 APIKEY
npx wrangler secret put HDK_PID         # 好单库 PID（推广位）
npx wrangler secret put HDK_TB_NAME     # 淘宝授权昵称（淘宝转链归因用）
npx wrangler secret put JD_UNION_ID     # 京东联盟 ID
npx wrangler secret put LLM_API_KEY     # 硅基流动 API Key（AI 对话）
npx wrangler secret put YZ_APP_KEY      # 云瞻平台 app_key（本地生活转链）
npx wrangler secret put YZ_APP_SECRET   # 云瞻平台 app_secret
npx wrangler secret put YZ_PROMOTION_ID # 云瞻推广位 ID
```

**每个命令执行后会提示 `Enter a secret value:`**——此时打开项目里的 `tools/.env` 文件，把对应变量等号后面的值**复制、粘贴进去、回车**。粘贴时不会显示任何字符，是正常的（防窥屏）。

值都在 `tools/.env` 里，一一对应：

| 命令里的名字 | .env 里的名字 | 用途 |
|---|---|---|
| HDK_APIKEY | HDK_APIKEY | 好单库数据 |
| HDK_PID | HDK_PID | 淘宝推广位 |
| HDK_TB_NAME | HDK_TB_NAME | 淘宝转链归因 |
| JD_UNION_ID | JD_UNION_ID | 京东转链归因 |
| LLM_API_KEY | LLM_API_KEY | AI 对话（硅基流动） |
| YZ_APP_KEY | YZ_APP_KEY | 本地生活（美团等）转链 |
| YZ_APP_SECRET | YZ_APP_SECRET | 同上 |
| YZ_PROMOTION_ID | YZ_PROMOTION_ID | 云瞻推广位 ID |

> 后 3 个（YZ_*）等云瞻平台的 app_key/app_secret/推广位ID 拿到后再配；不配也不影响其他功能，羊毛集合页会显示"即将上线"。
>
> ⚠️ **每次 `wrangler deploy` 后密钥会被清空，必须重新按上面命令再传一遍**（本账号的怪毛病，面板端操作也会清）。

> 💡 也可以不敲命令、全部在网页加：Cloudflare 面板 → **Workers & Pages → yangmao-aihub → Settings → Variables and Secrets → Add**，Name/Value 按上表填，类型选 **Secret**。效果一样。

---

## 第 4 步 · 部署！

```bash
cd /d/Workbuddy/羊毛网站/worker
npx wrangler deploy
```

成功后会打印类似：

```
Uploaded yangmao-aihub (1.23 sec)
Published yangmao-aihub (0.85 sec)
  https://yangmao-aihub.<你的子域>.workers.dev
 Current Version ID: xxxxxxxx-xxxx-...
```

**复制这个 `https://yangmao-aihub.xxx.workers.dev` 网址**，第 5 步要用。

---

## 第 5 步 · 把 Worker 网址填进前端

1. 用编辑器打开 `assets/common.js`
2. 找到这一行（文件开头附近）：
   ```js
   : "https://wool-ai-api.workers.dev"; // TODO: Worker 部署后替换为真实域名
   ```
3. 把 `https://wool-ai-api.workers.dev` 换成第 4 步复制的真实网址，保存
4. 提交并推送：
   ```bash
   cd /d/Workbuddy/羊毛网站
   git add assets/common.js
   git commit -m "填入 Worker 网址"
   git push
   ```

等 1~2 分钟 GitHub Pages 自动部署后，打开 **https://chenking-maker.github.io/yangmao-aihub/** —— 商品、线报、对话应该全部有真实数据了，顶部不再有「AI 选品服务未连接」提示。

---

## 第 6 步 · 自检（可选）

浏览器打开你的 Worker 网址 + `/api/health`，例如：

```
https://yangmao-aihub.<你的子域>.workers.dev/api/health
```

应返回：

```json
{"ok":true,"hasKey":true,"hasLLM":true}
```

`hasKey` / `hasLLM` 都是 `true` 说明密钥配齐了。

---

## 常见问题

| 现象 | 原因 / 解决 |
|------|------|
| `npx wrangler deploy` 报 `Authentication error` | 重做第 1 步 `npx wrangler login` |
| 部署成功但网站还提示服务未连接 | 第 5 步没做或网址填错；常见看错点是多写了 `/` 结尾 |
| health 返回 `hasKey:false` | 第 3 步有 secret 没加或名字打错，面板 Settings → Variables and Secrets 里核对 |
| **接口突然全部 404 / 网站显示服务加载中** | ⚠️ 两个坑：① **每次 `wrangler deploy` 会把 secret 清空**，部署后必须按第 3 步把 8 个密钥重传一遍；② 本仓库在 Cloudflare 接了 **Git 推送自动构建**（push 后约 40 秒自动部署一次），根目录的 `wrangler.toml` 已保证它部署的是正确代码——**不要删根目录那个 wrangler.toml**，删了自动构建就会把仓库当静态资源部署，接口全 404 |
| 京东链接转链降级为原始链接 | 个别京东链接偶发转不出通道，属正常降级；淘宝/淘口令转链不受影响 |
| AI 对话不出商品卡 | `LLM_API_KEY` 没配或硅基流动 key 失效；health 里 `hasLLM:false` 就是这个原因 |
| 改了代码怎么更新 | `cd worker && npx wrangler deploy`，**然后重传 8 个密钥**；或者直接 `git push`（自动构建会代劳，且不清密钥） |

---

## 附：目录里各文件的作用

```
worker/
├─ wrangler.toml      # 服务名/入口/公开变量（无密钥）
├─ src/index.js       # 路由：/api/search /api/wire /api/chat /api/convert ...
├─ src/core.js        # 好单库 API 封装、转链、图片代理
└─ src/yunzhan.js     # 云瞻 CPS（本地生活）转链：签名/业务列表/推广链接

（仓库根目录还有一个 wrangler.toml，是给 Git 推送自动构建用的，别删）
```

本地联调：`NODE_USE_ENV_PROXY=1 node tools/dev-api.mjs`（端口 8790，读 `tools/.env`）。
