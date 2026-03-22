# Polish Transcripts

精修播客文字稿 - 添加标点、识别说话人、修正语音识别错误。

## 用法

- `/polish <podcast_id>` — 精修指定播客的所有未精修文字稿
- `/polish <episode_id1> <episode_id2> ...` — 精修指定 episode
- `/polish all` — 精修所有未精修的文字稿

## 执行步骤

1. 先查询数据库确认哪些 episode 需要精修（source != 'llm_polish' 且尚无 llm_polish 版本）：

```bash
# 按 podcast_id 查
sqlite3 /home/mhliu/podcast-transcript-forum/data/podcast.db \
  "SELECT e.id, e.title, length(t.content) FROM episodes e JOIN transcripts t ON t.episode_id=e.id WHERE e.podcast_id=<PODCAST_ID> AND t.source='asr' AND e.id NOT IN (SELECT episode_id FROM transcripts WHERE source='llm_polish');"
```

2. 运行 fast-polish 脚本，传入 episode IDs 作为优先处理：

```bash
cd /home/mhliu/podcast-transcript-forum && node scripts/fast-polish.js <EPISODE_IDS...>
```

脚本会自动：
- 将原始 ASR 文稿分块发送到 LLM
- 添加标点符号
- 识别并标记说话人（`**[真名]**` 格式）
- 跨 chunk 保持说话人一致性
- 替换泛称（嘉宾、Guest 等）为真名
- 保存精修版本到数据库（source='llm_polish'）

3. 验证精修结果：

```bash
sqlite3 /home/mhliu/podcast-transcript-forum/data/podcast.db \
  "SELECT episode_id, source, length(content) FROM transcripts WHERE episode_id IN (<IDS>) ORDER BY episode_id, source;"
```

## 参数

$ARGUMENTS
