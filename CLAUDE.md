# What we are building

一个podcast transcript forum。核心功能，以富有科技感、高级审美的前端界面实现的播客文本查看（以最适合播客文本的方式显示，跨端适配做好）、原链接（方便用户点击收听），提供类别分类，按播客主分类，并提供全面的查询功能（模糊匹配、播客名称、内容名称、主角名称等）
你需要完成产品的界面优化，功能测试
**注意**：需要设计多种测试用例，并在实现后保证工具完全通过测试。

Now we are trying our best to find out the problems in existing podcast transcripts (e.g., wrong speaker split, bad paragraph, etc) and revising it to bring the best podcast transcript experience to people.

git 仓库：git@github.com:Ericonaldo/podcast-transcript-forum.git

---

# Public Server 部署

You can access the public server using:

```bash
ssh newserver
```

This server is publicly accessible and will host the page.

---

# Your Job

Continue working until **all features are confirmed working and all tests pass**.

Use your **bash and Chrome MCP** to verify that all functions work.

Keep working until **all functions are confirmed working**.

---
你参考使用的工具：/home/mhliu/podcast_chrome
# EchoShell (Chrome Extension) 产品需求文档 (PRD)

**EchoShell** 是一款专为播客（Podcast）和在线视频设计的浏览器插件。它通过 **音频抓取 (ASR)** 和 **视觉字幕识别 (OCR)** 双模驱动，并采用 **BYOK (Bring Your Own Key)** 模式，为用户提供高隐私、低成本的实时转译解决方案。

---

## 1. 项目概览
* **项目名称**: EchoShell
* **形态**: Chrome Extension (Manifest V3)
* **核心模式**: BYOK (用户自备 OpenAI/Deepgram/Anthropic 等 API Key)
* **目标**: 实现网页音视频的“所听即所得”与“所见即所得”。

---

## 2. 核心功能模块

### 2.1 双重捕获引擎 (Dual-Capture Engine)
1.  **音频转译模式 (Audio-to-Text)**
    * **原理**: 调用 `chrome.offscreen` API 捕获当前标签页频流（Tab Capture）。
    * **处理**: 将音频流进行 PCM 编码处理，并按设定的时间间隔（如 10s）或静音检测（VAD）进行切片。
    * **分发**: 发送至用户配置的 ASR API（如 OpenAI Whisper）。
2.  **视觉 OCR 模式 (Screen-to-Text)**
    * **原理**: 使用 `getDisplayMedia` 获取视频轨道帧。
    * **逻辑**: 针对 YouTube/Bilibili 等带硬字幕的视频，实时提取画面底部区域进行 OCR 识别。
    * **优化**: 采用帧差异算法，仅当画面发生显著变化时才触发 API 调用，节省 Token。

### 2.2 BYOK 配置中心 (Settings Panel)
用户可自主配置服务商，数据严格存储于 `chrome.storage.local`：
* **ASR Provider**: OpenAI, Deepgram, Groq, Whisper.cpp (Local)。
* **LLM Provider**: 用于文本校阅（GPT-4o-mini, Claude 3.5 Sonnet）。
* **Custom Endpoint**: 支持 OpenAI 兼容格式的自定义中转地址。
* **API Key**: 加密存储，仅在请求时调用。

### 2.3 实时交互 UI (User Interface)
* **Side Panel (侧边栏)**: 实时流式展示转录文本，支持点击时间戳跳转视频进度。
* **Floating Subtitles (悬浮窗)**: 在视频播放器上方叠加一层经过 LLM 优化后的“精修字幕”。
* **History Manager**: 本地存储转译记录，支持一键导出为 `.txt`, `.md`, `.srt` 格式。

---

## 3. 技术架构 (Technical Architecture)

### 3.1 核心组件
* **Background Service Worker**: 处理插件生命周期与消息转发。
* **Offscreen Document**: 突破 V3 限制，用于处理 `AudioContext` 和 `MediaRecorder` 等媒体流操作。
* **Content Scripts**: 负责注入 DOM，抓取特定网站（如 YouTube）的元数据。
* **Side Panel API**: 提供原生侧边栏交互体验。

### 3.2 数据流向
1. `Tab Audio/Video` -> `Offscreen Document` (处理流)
2. `Offscreen` -> `ASR/OCR API` (携带用户私钥)
3. `API Response` -> `Side Panel` (渲染文本)
4. `Text Blocks` -> `LLM` (可选：润色/总结)

---

## 4. 权限需求 (Manifest Permissions)
```json
{
  "permissions": [
    "tabCapture",
    "storage",
    "sidePanel",
    "offscreen",
    "activeTab",
    "scripting"
  ],
  "host_permissions": [
    "[https://api.openai.com/](https://api.openai.com/)*",
    "[https://api.deepgram.com/](https://api.deepgram.com/)*",
    "<all_urls>"
  ]
}

---

# Deploy SOP (部署标准流程)

**关键原则：在 worktree 中修改代码后，必须在 main repo 中 pull 最新代码再构建，不要在 worktree 中构建。**

完整部署流程：

```bash
# 1. 在 worktree 中提交并推送到 main
git add <files>
git commit -m "feat/fix: ..."
git fetch origin main && git rebase origin/main
git push origin <worktree-branch>:main

# 2. 在 main repo 中同步并构建（关键！）
cd /home/mhliu/podcast-transcript-forum
git pull origin main
cd client && rm -rf dist && npx vite build

# 3. 上传构建产物到服务器
rsync -avz --delete /home/mhliu/podcast-transcript-forum/client/dist/ newserver:/home/prod/podcast-forum/client/dist/

# 4. 同步服务端代码（如果改了 server/）
ssh newserver "cd /home/prod/podcast-forum && git pull origin main"

# 5. 重启服务器
ssh newserver "kill $(ssh newserver 'ss -tlnp | grep 4010 | grep -oP "pid=\d+" | grep -oP "\d+"') 2>/dev/null"
ssh newserver "cd /home/prod/podcast-forum && nohup node server/src/index.js > server.log 2>&1 & echo PID=\$!"

# 6. 验证
sleep 2 && ssh newserver "curl -s -o /dev/null -w '%{http_code}' http://localhost:4010/"
```

**常见踩坑**：
- 服务器 Node v20 无法运行 `vite build`（需 Node ≥ 22），所以必须在本地构建
- `express.static` 对 index.html 已配置 `no-cache`，部署后用户刷新即可获取最新版本
- 不要混淆 worktree 的构建产物和 main repo 的构建产物

---

# Submit Code

All code should be committed on a **task branch**:

```bash
git commit
```

---

# Merge + Test

```bash
git fetch origin && git merge origin/main
npm test
```

---

# Auto Commit and Merge to Main

After each feature is completed and all tests pass, you must **commit and then merge to `main`**.

Before each commit, update related documentation if new features are added.

Workflow:

1. Sync main branch

```bash
git fetch origin main
```

2. Rebase your task branch

```bash
git rebase origin/main
```

3. If rebase fails, follow the **Conflict Resolution** section below.

4. If rebase succeeds:

```bash
git merge main task-xxx
git push origin main
```

5. Continue with the next task.

6. If **any step fails**, return to **Step 5** in the workflow.

---

# Mark Task Completion

Update `dev-tasks.json` **before cleanup** to prevent losing task status if the process is killed.

---

# Cleanup

After task completion:

- Remove the worktree:

```bash
git worktree remove
```

- Delete the local branch
- Delete the remote task branch
- Restart the development server

---

# Knowledge Capture (Optional)

Record lessons learned in `PROGRESS.md`.

This is optional because task status is already recorded in `dev-tasks.json`, so even if the process is killed, the task state is preserved.

---

# Multi-Instance Parallel Development (Git Worktree)

## Architecture Overview

Multiple Claude Code instances can run **in parallel**, with each instance working in an **independent `git worktree`**.

---

## Parallel Development Workflow

```
┌──────────────────────────────────────────────┐
│              Parallel Development Workflow   │
└──────────────────────────────────────────────┘

   ┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐
   │      Worker 1      │   │      Worker 2      │   │      Worker 3      │
   │     port:5200      │   │     port:5201      │   │     port:5202      │
   │      worktree      │   │      worktree      │   │      worktree      │
   └────────────────────┘   └────────────────────┘   └────────────────────┘
            │                         │                         │
        ┌────────┐               ┌────────┐               ┌────────┐
        │ data/  │               │ data/  │               │ data/  │
        └────────┘               └────────┘               └────────┘

                     (isolated experimental data)
```

---

# ⚠️ Symlink Is Forbidden

Do **not create symbolic links** for:

```
PROGRESS.md
```

Always edit the main repository file directly using:

```bash
git -C
```

---

# Conflict Resolution

## Handling Rebase Failures

1. If the error is `"unstaged changes"`:

Commit or stash the current modifications first.

```bash
git commit
```

or

```bash
git stash
```

---

2. If there are **merge conflicts**:

Check conflicting files:

```bash
git status
```

Open the conflicting files and understand the changes from both sides.

Manually resolve the conflicts.

Stage the resolved files:

```bash
git add <resolved-files>
```

Continue the rebase:

```bash
git rebase --continue
```

Repeat until the rebase completes.

---

# Handling Test Failures

1. Run tests:

```bash
npm test
```

2. If tests fail:

- Analyze the error messages
- Fix the bugs in the code

3. Run tests again until **all tests pass**.

4. Commit the fix:

```bash
git commit -m "fix: ..."
```

---

# Never Give Up

If a **rebase or test fails**, you **must resolve the issue before continuing**.

Do **not mark the task as failed**.

---

# Knowledge Recording

Whenever you encounter a problem or complete an important change, record it in:

```
PROGRESS.md
```

Include:

- What problem occurred
- How it was solved
- How to avoid it in the future
- **The corresponding Git commit ID**

---

# Important Rule

**Do not make the same mistake twice.**

And remember:

> **After every new feature, update the README and documentation.**


---

# Podcast Transcript Pipeline

## Skills / Scripts

### 1. ASR + Speaker Diarization (新episode)
```bash
# 单集
npm run asr -- --episode-id=166

# 整个播客
npm run asr -- --podcast-id=16

# 只做ASR不精修
npm run asr -- --podcast-id=17 --no-polish

# 重新处理已有文稿的episode
npm run asr -- --episode-id=166 --reprocess
```

### 2. Re-polish with Diarization (已有文稿)
```bash
# 所有中文播客
node scripts/repolish-all-zh.js

# 指定播客
node scripts/repolish-all-zh.js --podcast-id=16
```

### 3. 拉取最新episode
```bash
npm run update
npm run update -- --podcast-id=16 --limit=20
```

### 4. 精修未精修的ASR文稿
```bash
npm run polish
```

## Pipeline流程

### 新episode（无文稿）→ `npm run asr`
1. 下载音频（B站cookies > YouTube > 小宇宙 > RSS）
2. whisperx transcribe（GPU转录）
3. whisperx align（时间对齐）
4. pyannote diarize（音频级说话人分离 SPEAKER_00/01）
5. 按说话人+60s分段生成带标签的文稿
6. LLM polish：SPEAKER_XX→真名 + 标点 + 段落合并
7. `npm run postprocess`

### 已有文稿 re-polish → `node scripts/repolish-all-zh.js`
1. **保留原始ASR/VTT文稿**（文字内容和顺序不变！）
2. 下载音频 → pyannote diarize（只获取说话人时间戳）
3. 按时间对齐，将SPEAKER_XX叠加到原始文稿每段
4. LLM polish：**严禁改写原文！**只做 SPEAKER_XX→真名 + 标点 + 段落合并
5. `npm run postprocess`

### ⚠️ 关键原则
- **re-polish绝不重新转录**，只在原始文稿上叠加说话人标签
- LLM prompt必须强调"严禁改变原文内容和顺序"
- 说话人姓名必须参考episode description（避免同音字）

## 环境变量 (.env)

```
LLM_API_KEY=sk-xxx          # OpenAI兼容API key
LLM_API_URL=http://...      # API endpoint
LLM_MODEL=deepseek-chat     # 默认模型
HF_TOKEN=hf_xxx             # HuggingFace token (pyannote)
```

## 视频链接优先级

bilibili > youtube > 小宇宙 > 其他

## 注意事项

- B站全局搜索匹配BV ID不可靠，需从B站空间页提取或API验证owner
- YouTube被bot检测ban时，改用B站或小宇宙下载音频
- 长播客(>5hr)的JSON输出需写文件而非stdout（避免buffer overflow）
- speaker name必须参考episode description，避免同音字（如季逸超≠纪忆超）

## 文稿排版规则

- 同一说话人的连续短段落必须合并为大段落（像文章，非碎片对话）
- 每个说话人的一轮发言 = 一个完整段落
- 时间戳只在每个大段落开头保留一个
- LLM模型使用fallback chain：deepseek-chat → gpt-4o-mini → deepseek-v3 → gpt-4o

## 后处理规则 (postprocess-polish.js)

每次polish完成后必须运行 `npm run postprocess`：

1. 删除泄露的LLM prompt（"Part X/Y", "Use these exact names"等）
2. 删除空行和只有speaker tag的行
3. 合并连续相同说话人的段落（核心规则！）
4. 删除speaker tag后的冒号
5. 标准化tag格式 **[Name]**
