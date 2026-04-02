#!/usr/bin/env node
/**
 * Re-polish a single episode from its asr_diarized source.
 * Preserves speaker splits strictly — does NOT re-run diarization.
 *
 * Usage: node scripts/repolish-ep.js --episode-id=96
 */
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');

const API_KEY = process.env.LLM_API_KEY;
const API_URL = process.env.LLM_API_URL || 'http://38.246.250.87:3000/v1/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const CHUNK_SIZE = 3000;
const MODELS = [LLM_MODEL, 'gpt-4o-mini', 'deepseek-v3', 'gpt-4o'];

const args = process.argv.slice(2);
const episodeId = args.find(a => a.startsWith('--episode-id='))?.split('=')[1];
if (!episodeId) { console.log('Usage: node scripts/repolish-ep.js --episode-id=96'); process.exit(1); }

async function callLLM(messages) {
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, max_tokens: 4096 })
        });
        if (r.status === 429) { await new Promise(r => setTimeout(r, 5000 * (attempt + 1))); continue; }
        if (!r.ok) { await new Promise(r => setTimeout(r, 3000)); continue; }
        const d = await r.json();
        return d?.choices?.[0]?.message?.content || null;
      } catch (e) { await new Promise(r => setTimeout(r, 5000)); }
    }
  }
  return null;
}

// PLACEHOLDER_MORE_CODE

async function main() {
  const db = getDb();
  const ep = db.prepare(`
    SELECT e.id, e.title, e.description, e.guests, p.name as podcast_name, p.host
    FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE e.id=?
  `).get(parseInt(episodeId));
  if (!ep) { console.log('Episode not found'); process.exit(1); }

  const raw = db.prepare("SELECT content FROM transcripts WHERE episode_id=? AND source='asr_diarized'").get(ep.id);
  if (!raw) { console.log('No asr_diarized transcript'); process.exit(1); }

  console.log(`Episode ${ep.id}: ${ep.title.slice(0, 60)}`);
  console.log(`Podcast: ${ep.podcast_name}, Host: ${ep.host}`);
  console.log(`Raw: ${(raw.content.length / 1000).toFixed(0)}k chars, ${raw.content.split('\n').length} lines`);

  // Detect speaker mapping from content
  const speakerCounts = {};
  for (const line of raw.content.split('\n')) {
    const m = line.match(/\[(SPEAKER_\d+)\]/);
    if (m) speakerCounts[m[1]] = (speakerCounts[m[1]] || 0) + 1;
  }
  console.log('Speaker counts:', speakerCounts);

  // Build speaker name mapping from description
  const descHint = ep.description ? ep.description.slice(0, 500) : '';
  const hostName = ep.host || '主持人';
  // For ep96: SPEAKER_00 = 张小珺 (opens with "哈喽 大家好 我是小珺")
  const firstLine = raw.content.split('\n')[0];
  const firstSpeaker = firstLine.match(/\[(SPEAKER_\d+)\]/)?.[1] || 'SPEAKER_00';

  const sys = `你是播客文字稿编辑器。以下文稿已标注了说话人ID。

播客：${ep.podcast_name}
本期：${ep.title}
节目简介（参考嘉宾姓名）：${descHint}

说话人映射（${firstSpeaker}是开场的主持人）：
- ${firstSpeaker} = ${hostName}（主持人）
- 另一位 = 嘉宾（从简介中找到真实姓名）

严格要求：
1. 将SPEAKER_XX替换为真实姓名，用**[真名]**格式
2. 添加标点符号，修正明显的语音识别错误（同音字等）
3. **绝对保留原文所有文字和顺序不变**，不要删减、改写或重新组织内容
4. **绝对保留每一次说话人切换**——输入中每次SPEAKER切换，输出中必须对应一次说话人切换
5. 短回应（如"嗯"、"对"、"是的"）如果在输入中标注为不同说话人，输出中也必须保持为不同说话人的独立段落
6. 同一说话人的连续内容合并为段落，但绝不跨说话人合并
7. 保留时间戳[MM:SS]
8. 不要输出任何解释，只输出处理后的文稿`;

  // Chunk
  const lines = raw.content.split('\n');
  const chunks = []; let cur = '';
  for (const l of lines) {
    if (cur.length + l.length > CHUNK_SIZE && cur.length > 0) { chunks.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + l;
  }
  if (cur) chunks.push(cur);
  console.log(`Chunks: ${chunks.length}`);

  // Count speaker changes in raw
  let rawChanges = 0;
  let lastRawSpeaker = null;
  for (const line of lines) {
    const m = line.match(/\[(SPEAKER_\d+)\]/);
    if (m && m[1] !== lastRawSpeaker) { rawChanges++; lastRawSpeaker = m[1]; }
  }
  console.log(`Raw speaker changes: ${rawChanges}`);

  // Polish each chunk
  const results = [];
  let speakerMap = '';
  const start = Date.now();
  for (let i = 0; i < chunks.length; i++) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    process.stdout.write(`  [${elapsed}s] P${i + 1}/${chunks.length} `);
    const hint = i > 0 && speakerMap ? `\n\n(Part ${i + 1}/${chunks.length}. ${speakerMap})` : '';
    const polished = await callLLM([{ role: 'system', content: sys }, { role: 'user', content: chunks[i] + hint }]);
    if (!polished) { console.log('FAIL'); results.push(chunks[i]); continue; }
    results.push(polished);
    const names = new Set(); let m;
    const re = /\*\*\[([^\]]+)\]\*\*/g;
    while ((m = re.exec(polished)) !== null) names.add(m[1]);
    if (names.size > 0) speakerMap = 'Use these exact names: ' + [...names].join(', ');
    console.log(`OK (${names.size} speakers: ${[...names].join(', ')})`);
  }

  let content = results.join('\n\n');

  // Normalize tags
  content = content.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*[：:]\s*/g, '$1**[$2]** ');
  content = content.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*(\s)/g, (m, pre, name, sp) => pre + '**[' + name.trim() + ']**' + sp);
  content = content.replace(/\*\*\[([^\]]+)\]\s*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\*\*/g, '**[$1]** [$2]');
  content = content.replace(/^\*\*\[[^\]]+\]\*\*\s*$/gm, '').replace(/\n{3,}/g, '\n\n');

  // Remove leaked LLM prompt artifacts
  content = content.replace(/^.*Part \d+\/\d+.*$/gm, '');
  content = content.replace(/^.*Use these exact names.*$/gm, '');
  content = content.replace(/\n{3,}/g, '\n\n');

  // Count speaker changes in polished
  let polishChanges = 0;
  let lastPolishSpeaker = null;
  const polishRe = /\*\*\[([^\]]+)\]\*\*/g;
  let pm;
  while ((pm = polishRe.exec(content)) !== null) {
    if (pm[1] !== lastPolishSpeaker) { polishChanges++; lastPolishSpeaker = pm[1]; }
  }

  // Speaker count
  const tc = {};
  const tre = /\*\*\[([^\]]+)\]\*\*/g;
  while ((pm = tre.exec(content)) !== null) tc[pm[1]] = (tc[pm[1]] || 0) + 1;

  console.log(`\nSpeaker changes: raw=${rawChanges} -> polished=${polishChanges}`);
  console.log('Speaker counts:', tc);
  if (polishChanges < rawChanges * 0.7) {
    console.log('WARNING: Polish lost >30% of speaker changes! Review carefully.');
  }

  // Save
  const existing = db.prepare("SELECT id FROM transcripts WHERE episode_id=? AND source='llm_polish'").get(ep.id);
  if (existing) {
    // Backup old polish
    const old = db.prepare("SELECT content FROM transcripts WHERE id=?").get(existing.id);
    if (old) {
      db.prepare("INSERT OR IGNORE INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'zh', 'llm_polish_backup')").run(ep.id, old.content);
    }
    db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(content, existing.id);
    console.log(`Updated polish (id=${existing.id}), ${(content.length / 1000).toFixed(0)}k chars`);
  } else {
    db.prepare("INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'zh', 'llm_polish')").run(ep.id, content);
    console.log(`Created polish, ${(content.length / 1000).toFixed(0)}k chars`);
  }

  console.log(`Done in ${((Date.now() - start) / 60000).toFixed(1)}m`);
  closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
