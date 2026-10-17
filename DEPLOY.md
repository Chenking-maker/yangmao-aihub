# 上传到 GitHub 并上线（完整步骤）

> 目标：把「羊毛AIHUB」变成一个任何人都能访问的网址。
> 网站分两部分：**前端**（页面，放 GitHub Pages，免费免备案）+ **后端**（AI 选品 / 转链 API，放 Cloudflare Worker，免费额度）。
> 两部分都要上线，商品和线报才会显示真实数据；只传前端的话，页面会提示「AI 选品服务未连接」。

---

## 第一部分：前端 → GitHub Pages

### 1. 装 Git（没装过才需要）
- 下载安装 https://git-scm.com/download/win ，一路下一步。
- 装完在「开始菜单」打开 **Git Bash**。

### 2. 在 GitHub 建一个空仓库
1. 登录 https://github.com
2. 右上角 **+** → **New repository**
3. **Repository name** 填：`yangmao-aihub`（可自取，别用中文）
4. 选 **Public**（公开）
5. **不要**勾选 "Add a README"（保持空仓库，避免冲突）
6. 点 **Create repository**

### 3. 把本地代码推上去
在 **Git Bash** 里，逐行粘贴执行（把 `你的用户名` 换成你的 GitHub 用户名）：

```bash
cd /d/Workbuddy/羊毛网站

# 关联到刚建的空仓库（只需第一次）
git remote add origin https://github.com/你的用户名/yangmao-aihub.git

# 推送
git push -u origin master
```

> 仓库已经建好并推送过一次（`https://github.com/Chenking-maker/yangmao-aihub`），
> 以后更新代码只需要：`git add . && git commit -m "更新说明" && git push`。

> 如果提示输入用户名/密码：用户名填 GitHub 用户名，**密码不是登录密码**，而是
> GitHub → Settings → Developer settings → Personal access tokens → Tokens(classic) → Generate new token，
> 勾选 `repo` 权限后生成的那串 `ghp_...`。把它当密码粘贴。

### 4. 开启 GitHub Pages
1. 仓库页面 → **Settings** → 左侧 **Pages**
2. **Source** 选 **Deploy from a branch**
3. **Branch** 选 `master`，文件夹选 `/(root)`，点 **Save**
4. 等 1~2 分钟，刷新页面，顶部会出现网址：
   **`https://你的用户名.github.io/yangmao-aihub/`**

到这个网址能打开页面 = 前端上线成功。但此时商品/线报还是连不上（后端没上线），页面顶部会显示「AI 选品服务未连接」的提示条——继续做第二部分。

---

## 第二部分：后端 → Cloudflare Worker（让真实数据跑起来）

### 5. 准备 Cloudflare
1. 注册/登录 https://dash.cloudflare.com （免费）
2. 左侧 **Workers & Pages**

### 6. 配置密钥并部署
在 **Git Bash** 里执行（都在 `worker` 目录下）：

```bash
cd /d/Workbuddy/羊毛网站/worker

# 第一次用 wrangler 会弹出浏览器登录 Cloudflare，点允许
npx wrangler secret put HDK_APIKEY      # 粘贴好单库 apikey
npx wrangler secret put HDK_PID         # 粘贴推广位 PID
npx wrangler secret put HDK_TB_NAME     # 粘贴 chenking陈逸希
npx wrangler secret put JD_UNION_ID     # 1000559363
npx wrangler secret put LLM_API_KEY     # 硅基流动 key
npx wrangler secret put LLM_BASE_URL    # https://api.siliconflow.cn/v1
npx wrangler secret put LLM_MODEL       # Qwen/Qwen2.5-7B-Instruct

# 部署
npx wrangler deploy
```

> 密钥值从哪来：都在本地 `tools/.env` 文件里（`HDK_APIKEY=...` 等号后面那串）。
> 每条 `secret put` 命令执行后，把值粘贴进去、回车。

### 7. 拿到 Worker 网址并填进前端
- `wrangler deploy` 成功后，会打印一个网址，类似：
  **`https://yangmao-aihub.370542303.workers.dev`**
- 打开 `assets/common.js`，搜索 `wool-ai-api.workers.dev`，把它换成上面打印的真实网址，保存。

### 8. 重新推送前端（让改动生效）
```bash
cd /d/Workbuddy/羊毛网站
git add assets/common.js
git commit -m "chore: 填入 Worker 后端网址"
git push
```

等 GitHub Pages 自动刷新（约 1 分钟），再打开你的网址——商品、线报、转链就全部是真实数据了。

---

## 常见问题

| 现象 | 原因 / 解决 |
|------|------|
| 页面顶部显示「AI 选品服务未连接」 | 后端 Worker 没部署，或 `common.js` 里的 Worker 网址没填对。做完第二部分的 5-8 步。 |
| 本地想先看效果 | 两个服务都开着：`node tools/dev-api.mjs`（API，8790）+ 静态页 8080，访问 http://127.0.0.1:8080 |
| `git push` 要密码 | 用 GitHub Personal access token（`ghp_...`），不是账号密码，见第 3 步 |
| `git push` 连不上 | 检查你自己的代理（Clash 等）是否在跑；git 走的是系统代理 |
| 以后改了代码怎么更新 | 在项目目录执行 `git add . && git commit -m "更新" && git push`，Pages 会自动重新发布 |

---

## 附：上传微信群二维码

微信群页面（`wechat.html`）的二维码由你本人上传：

1. 二维码图片放进 `qrcodes/`（如 `group1.png`）
2. 编辑 `qrcodes/groups.json`，按格式加一条（字段说明见 `qrcodes/README.md`）
3. `git add . && git commit -m "更新群二维码" && git push`

微信群码 7 天过期，过期换图后改一下 `groups.json` 里的路径再推一次即可。

---

## 一页流程图

```
写代码/改代码
   │
   ├─ 前端(/) ──push──▶ GitHub ──Pages──▶ https://用户名.github.io/yangmao-aihub/
   │                                              │  页面里调用 API_BASE
   └─ 后端(worker/) ─deploy─▶ Cloudflare Worker ─┘（真实商品/线报/转链）
```
