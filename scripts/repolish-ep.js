#!/usr/bin/env node
/**
 * Re-polish episodes from their asr_diarized source.
 * Preserves speaker splits strictly — does NOT re-run diarization.
 *
 * Usage:
 *   node scripts/repolish-ep.js --episode-id=96        # single episode
 *   node scripts/repolish-ep.js --all-zh                # all Chinese podcasts
 *   node scripts/repolish-ep.js --podcast-id=16         # specific podcast
 *   node scripts/repolish-ep.js --all-zh --skip=96,100  # skip specific episodes
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
const podcastId = args.find(a => a.startsWith('--podcast-id='))?.split('=')[1];
const allZh = args.includes('--all-zh');
const skipIds = (args.find(a => a.startsWith('--skip='))?.split('=')[1] || '').split(',').filter(Boolean).map(Number);

if (!episodeId && !allZh && !podcastId) {
  console.log('Usage: node scripts/repolish-ep.js --episode-id=96 | --all-zh | --podcast-id=16');
  process.exit(1);
}

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

async function polishEpisode(db, ep) {
  const raw = db.prepare("SELECT content FROM transcripts WHERE episode_id=? AND source='asr_diarized'").get(ep.id);
  if (!raw) return 'SKIP(no asr_diarized)';

  const lines = raw.content.split('\n');
  const descHint = ep.description ? ep.description.slice(0, 500) : '';
  const hostName = ep.host || '主持人';
  const firstLine = lines[0] || '';
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
  const chunks = []; let cur = '';
  for (const l of lines) {
    if (cur.length + l.length > CHUNK_SIZE && cur.length > 0) { chunks.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + l;
  }
  if (cur) chunks.push(cur);

  // Polish each chunk
  const results = [];
  let speakerMap = '';
  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(`P${i + 1}/${chunks.length} `);
    const hint = i > 0 && speakerMap ? `\n\n(Part ${i + 1}/${chunks.length}. ${speakerMap})` : '';
    const polished = await callLLM([{ role: 'system', content: sys }, { role: 'user', content: chunks[i] + hint }]);
    if (!polished) { results.push(chunks[i]); continue; }
    results.push(polished);
    const names = new Set(); let m;
    const re = /\*\*\[([^\]]+)\]\*\*/g;
    while ((m = re.exec(polished)) !== null) names.add(m[1]);
    if (names.size > 0) speakerMap = 'Use these exact names: ' + [...names].join(', ');
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

  // Replace UNKNOWN/未知说话人 with the most common speaker (usually the host/listener)
  const tc = {};
  const tre = /\*\*\[([^\]]+)\]\*\*/g; let pm;
  while ((pm = tre.exec(content)) !== null) tc[pm[1]] = (tc[pm[1]] || 0) + 1;
  const realNames = Object.keys(tc).filter(n => !['UNKNOWN', '未知说话人', '未知', 'Unknown'].includes(n));
  if (realNames.length >= 1) {
    // Replace UNKNOWN with the host (usually first real name by appearance)
    const hostGuess = realNames.find(n => tc[n] > 10) || realNames[0];
    for (const unk of ['UNKNOWN', '未知说话人', '未知', 'Unknown']) {
      if (tc[unk]) content = content.replaceAll(`**[${unk}]**`, `**[${hostGuess}]**`);
    }
  }

  // Save
  const existing = db.prepare("SELECT id FROM transcripts WHERE episode_id=? AND source='llm_polish'").get(ep.id);
  if (existing) {
    db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(content, existing.id);
  } else {
    db.prepare("INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'zh', 'llm_polish')").run(ep.id, content);
  }

  // Recount after cleanup
  const finalTc = {};
  const fre = /\*\*\[([^\]]+)\]\*\*/g;
  while ((pm = fre.exec(content)) !== null) finalTc[pm[1]] = (finalTc[pm[1]] || 0) + 1;

  return `OK (${chunks.length} chunks, ${(content.length/1000).toFixed(0)}k, speakers: ${JSON.stringify(finalTc)})`;
}

async function main() {
  const db = getDb();

  let episodes;
  if (episodeId) {
    episodes = db.prepare(`
      SELECT e.id, e.title, e.description, e.guests, p.name as podcast_name, p.host
      FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE e.id=?
    `).all(parseInt(episodeId));
  } else {
    const where = podcastId ? `AND p.id=${parseInt(podcastId)}` : "AND p.language LIKE 'zh%'";
    episodes = db.prepare(`
      SELECT e.id, e.title, e.description, e.guests, p.name as podcast_name, p.host
      FROM episodes e JOIN podcasts p ON p.id=e.podcast_id
      WHERE 1=1 ${where}
      AND e.id IN (SELECT episode_id FROM transcripts WHERE source='asr_diarized')
      ORDER BY p.id, e.id
    `).all();
  }

  // Apply skip
  if (skipIds.length) episodes = episodes.filter(e => !skipIds.includes(e.id));

  console.log(`\n🔄 Re-polish: ${episodes.length} episodes\n`);
  const start = Date.now(); let done = 0, failed = 0, skipped = 0;

  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i];
    const elapsed = ((Date.now() - start) / 60000).toFixed(1);
    process.stdout.write(`[${i+1}/${episodes.length}] (${elapsed}m) ep${ep.id} ${ep.podcast_name?.slice(0,12)} | ${ep.title.slice(0,40)}... `);
    try {
      const result = await polishEpisode(db, ep);
      console.log(result);
      if (result.startsWith('OK')) done++;
      else if (result.startsWith('SKIP')) skipped++;
      else failed++;
    } catch (e) {
      console.log(`ERROR: ${e.message.slice(0, 80)}`);
      failed++;
    }
  }

  console.log(`\n✅ ${((Date.now()-start)/60000).toFixed(1)}m: ${done} polished, ${failed} failed, ${skipped} skipped`);
  closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
