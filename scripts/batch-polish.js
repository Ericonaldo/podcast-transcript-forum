#!/usr/bin/env node
/**
 * Batch LLM polish script for all unpolished transcripts.
 * Uses gpt-4o-mini via custom endpoint.
 */
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');

const API_KEY = 'sk-3ODOY96LmDCFgcBY1d1b586c01E448BcAbB5115bD8FbD2Fc';
const API_URL = 'http://38.246.250.87:3000/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
const CHUNK_SIZE = 2500;
const MAX_CONTENT_LEN = 200000; // Skip transcripts > 200k chars (too expensive)

function makeSystemPrompt(podcastName, isZh) {
  if (isZh) {
    return `你是一个专业的播客文字稿编辑器。将原始语音转录文本优化为高质量文字稿。

要求：
1. 添加标点符号（逗号、句号、问号、感叹号等）
2. 识别说话人，用 **[主持人]** **[嘉宾]** 或推断出的真名标记（播客：${podcastName}）
3. 按说话人轮次分段，换人另起一行
4. 保留 [MM:SS] 时间戳在段首
5. 不改变原意，不添加删除内容
6. 修正明显语音识别错误（同音字等）

只输出处理后文稿，不要解释。`;
  }
  return `You are a professional podcast transcript editor. Polish raw speech-to-text into high-quality readable transcripts.

Requirements:
1. Add punctuation (commas, periods, question marks, etc.)
2. Identify speakers, label them as **[Host]** **[Guest]** or inferred real names (Podcast: ${podcastName})
3. Separate by speaker turns, new line for each speaker change
4. Preserve [MM:SS] timestamps at paragraph starts
5. Do NOT change meaning, do NOT add or remove content
6. Fix obvious transcription errors

Output only the polished transcript, no explanations.`;
}

function parseVTTToPlainText(content) {
  const cueBlocks = content.split(/\n\s*\n/);
  const cues = [];
  for (const block of cueBlocks) {
    const lines = block.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (/^(WEBVTT|NOTE|STYLE|Kind:|Language:)/.test(lines[0])) continue;
    const timingIdx = lines.findIndex(l => l.includes('-->'));
    if (timingIdx === -1) continue;
    const m = lines[timingIdx].match(/([\d:.]+)/);
    const secs = m ? m[1].split(':').reduce((a, v, i, arr) => a + parseFloat(v) * Math.pow(60, arr.length - 1 - i), 0) : 0;
    const mm = Math.floor(secs / 60);
    const ss = Math.floor(secs % 60);
    const ts = mm + ':' + String(ss).padStart(2, '0');
    const text = lines.slice(timingIdx + 1)
      .map(l => l.replace(/<\d{1,2}:\d{2}:\d{2}[.,]\d{3}>/g, '').replace(/<\/?[a-z][^>]*>/gi, '').trim())
      .filter(Boolean).join(' ');
    if (text) cues.push({ ts, text, secs });
  }

  // Group into 60-second windows
  const groups = [];
  if (!cues.length) return content; // Fallback: return as-is
  let winStart = cues[0].secs;
  let winTexts = [];
  let winTs = cues[0].ts;
  for (const c of cues) {
    if (c.secs - winStart >= 60 && winTexts.length) {
      groups.push('[' + winTs + '] ' + winTexts.join(' '));
      winStart = c.secs;
      winTexts = [];
      winTs = c.ts;
    }
    winTexts.push(c.text);
  }
  if (winTexts.length) groups.push('[' + winTs + '] ' + winTexts.join(' '));
  return groups.join('\n');
}

async function callLLM(systemPrompt, text) {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      max_tokens: 4096
    })
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`API ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || text;
}

async function polishTranscript(db, episodeId, content, format, language, podcastName) {
  // Parse VTT to plain text
  let plainText = format === 'vtt' ? parseVTTToPlainText(content) : content;

  if (plainText.length > MAX_CONTENT_LEN) {
    // Truncate to MAX_CONTENT_LEN for very long transcripts
    const lines = plainText.split('\n');
    let truncated = '';
    for (const l of lines) {
      if (truncated.length + l.length > MAX_CONTENT_LEN) break;
      truncated += (truncated ? '\n' : '') + l;
    }
    plainText = truncated;
  }

  const isZh = /^zh/.test(language);
  const systemPrompt = makeSystemPrompt(podcastName, isZh);

  // Split into chunks
  const lines = plainText.split('\n');
  const chunks = [];
  let cur = '';
  for (const l of lines) {
    if (cur.length + l.length > CHUNK_SIZE && cur.length > 0) {
      chunks.push(cur);
      cur = '';
    }
    cur += (cur ? '\n' : '') + l;
  }
  if (cur) chunks.push(cur);

  const results = [];
  let speakerContext = ''; // Track speaker names across chunks for consistency
  for (let i = 0; i < chunks.length; i++) {
    let hint = '';
    if (i > 0) {
      hint = '\n\n(Part ' + (i + 1) + '/' + chunks.length;
      if (speakerContext) hint += '. Speaker names used so far: ' + speakerContext + '. You MUST use exactly these same names, do NOT use generic labels like "嘉宾" or "Guest"';
      hint += ')';
    }
    try {
      const polished = await callLLM(systemPrompt, chunks[i] + hint);
      results.push(polished);
      // Extract speaker names from this chunk to pass as context to next
      const names = new Set();
      const re = /\*\*\[([^\]]+)\]\*\*/g;
      let m;
      while ((m = re.exec(polished)) !== null) names.add(m[1]);
      if (names.size > 0) speakerContext = [...names].join(', ');
    } catch (e) {
      console.error(`    Chunk ${i + 1} failed: ${e.message}`);
      results.push(chunks[i]); // fallback to raw
    }
  }

  let polishedContent = results.join('\n\n');

  // Post-process: normalize speaker tag format
  // Fix **[Speaker] [MM:SS]** -> **[Speaker]** [MM:SS]
  polishedContent = polishedContent.replace(/\*\*\[([^\]]+)\]\s*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\*\*/g, '**[$1]** [$2]');
  // Remove empty lines that only have speaker tag + timestamp
  polishedContent = polishedContent.replace(/^\*\*\[[^\]]+\]\*\*\s*$/gm, '').replace(/\n{3,}/g, '\n\n');
  // Normalize generic speaker labels: replace "嘉宾"/"Guest" with the most-used non-host name
  const tagCounts = {};
  const tagRe = /\*\*\[([^\]]+)\]\*\*/g;
  let tm;
  while ((tm = tagRe.exec(polishedContent)) !== null) {
    tagCounts[tm[1]] = (tagCounts[tm[1]] || 0) + 1;
  }
  const genericLabels = ['嘉宾', 'Guest', '嘉宾A', '嘉宾B', 'Guest A', 'Guest B'];
  const realNames = Object.entries(tagCounts)
    .filter(([name]) => !genericLabels.includes(name) && !['主持人', 'Host'].includes(name))
    .sort((a, b) => b[1] - a[1]);
  // If we have both a generic label and a real name for the non-host, replace generic with real
  if (realNames.length >= 1) {
    for (const label of genericLabels) {
      if (tagCounts[label]) {
        polishedContent = polishedContent.replace(
          new RegExp('\\*\\*\\[' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]\\*\\*', 'g'),
          '**[' + realNames[0][0] + ']**'
        );
      }
    }
  }

  // Save to DB
  const existing = db.prepare("SELECT id FROM transcripts WHERE episode_id = ? AND source = 'llm_polish'").get(episodeId);
  if (existing) {
    db.prepare('UPDATE transcripts SET content=?, format=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(polishedContent, 'plain', existing.id);
  } else {
    db.prepare('INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, ?, ?, ?)').run(
      episodeId, polishedContent, 'plain', language, 'llm_polish'
    );
  }

  return { chunks: chunks.length, originalLen: content.length, polishedLen: polishedContent.length };
}

async function main() {
  const db = getDb();

  // Get all unpolished transcripts, prioritize Chinese
  const episodes = db.prepare(`
    SELECT t.episode_id, t.content, t.format, t.language, t.source,
           e.title, p.name as podcast_name, LENGTH(t.content) as content_len
    FROM transcripts t
    JOIN episodes e ON e.id = t.episode_id
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE t.source != 'llm_polish'
    AND t.episode_id NOT IN (SELECT episode_id FROM transcripts WHERE source = 'llm_polish')
    ORDER BY
      CASE WHEN t.language LIKE 'zh%' THEN 0 ELSE 1 END,
      LENGTH(t.content) ASC
  `).all();

  console.log(`\n📝 Batch Polish: ${episodes.length} episodes to process\n`);

  let done = 0, skipped = 0, failed = 0;
  const startTime = Date.now();

  for (const ep of episodes) {
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    process.stdout.write(`[${done + skipped + failed + 1}/${episodes.length}] (${elapsed}m) ${ep.podcast_name} | ${ep.title.slice(0, 40)}... `);

    if (ep.content_len > 500000) {
      console.log(`SKIP (${(ep.content_len / 1000).toFixed(0)}k chars, too large)`);
      skipped++;
      continue;
    }

    try {
      const result = await polishTranscript(db, ep.episode_id, ep.content, ep.format, ep.language, ep.podcast_name);
      console.log(`OK (${result.chunks} chunks, ${(result.polishedLen / 1000).toFixed(0)}k chars)`);
      done++;
    } catch (e) {
      console.log(`FAIL: ${e.message.slice(0, 80)}`);
      failed++;
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ Done in ${totalTime}m: ${done} polished, ${skipped} skipped, ${failed} failed`);

  closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
