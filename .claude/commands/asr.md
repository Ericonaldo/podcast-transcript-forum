# ASR Transcription

对播客 episode 进行语音识别（ASR），生成文字稿并自动精修。

## 用法

- `/asr <podcast_id1>,<podcast_id2>,...` — 对指定播客中无文字稿的 episode 进行 ASR
- `/asr episode <episode_id1> <episode_id2>` — 对指定 episode 进行 ASR

## 执行步骤

1. 先查询数据库确认哪些 episode 需要 ASR（无任何文字稿记录）：

```bash
sqlite3 /home/mhliu/podcast-transcript-forum/data/podcast.db \
  "SELECT e.id, e.title, e.episode_url, e.audio_url FROM episodes e WHERE e.podcast_id IN (<PODCAST_IDS>) AND e.id NOT IN (SELECT episode_id FROM transcripts) AND (e.episode_url IS NOT NULL OR e.audio_url IS NOT NULL);"
```

2. 运行 asr-priority 脚本：

```bash
cd /home/mhliu/podcast-transcript-forum && node scripts/asr-priority.js <PODCAST_IDS_COMMA_SEPARATED>
```

脚本流程：下载音频 (yt-dlp) → Whisper ASR (faster-whisper large-v3, GPU) → 保存 ASR 文稿 → LLM 精修 → 保存精修版

3. 如果只需要 ASR 不需要精修，使用 asr-zh.js：

```bash
cd /home/mhliu/podcast-transcript-forum && node scripts/asr-zh.js
```

4. 验证结果：

```bash
sqlite3 /home/mhliu/podcast-transcript-forum/data/podcast.db \
  "SELECT e.id, e.title, t.source, length(t.content) FROM episodes e JOIN transcripts t ON t.episode_id=e.id WHERE e.podcast_id IN (<PODCAST_IDS>) ORDER BY e.id, t.source;"
```

## 前置条件

- GPU 可用（faster-whisper 需要 CUDA）
- yt-dlp 已安装
- faster-whisper Python 包已安装

## 参数

$ARGUMENTS
