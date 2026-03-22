#!/usr/bin/env node
/**
 * Re-polish specific episodes that have broken speaker tags (e.g. [真名]).
 * Usage: node scripts/repolish.js 176 498 521 ...
 *
 * Reads the raw ASR transcript and re-runs LLM polish with improved prompt,
 * providing known speaker names from episode metadata (host/guest).
 */
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');

const API_KEY = 'sk-3ODOY96LmDCFgcBY1d1b586c01E448BcAbB5115bD8FbD2Fc';
const API_URL = 'http://38.246.250.87:3000/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
const CHUNK_SIZE = 3000;

async function callLLM(sys, text) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages: [{role:'system',content:sys},{role:'user',content:text}], max_tokens: 4096 })
      });
      if (resp.status === 429) { await new Promise(r => setTimeout(r, 5000*(attempt+1))); continue; }
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const d = await resp.json();
      return d?.choices?.[0]?.message?.content || text;
    } catch(e) {
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

function makePrompt(podcastName, host, guests) {
  const speakerInfo = [];
  if (host) speakerInfo.push(`主持人: ${host}`);
  if (guests) speakerInfo.push(`嘉宾: ${guests}`);
  const speakerHint = speakerInfo.length > 0 ? `。已知说话人：${speakerInfo.join('，')}` : '';

  return `你是播客文字稿编辑器。优化原始语音转录为可读文字稿。
要求：
1. 添加标点符号
2. 识别说话人，用**[说话人真实姓名]**格式标记（播客:${podcastName}${speakerHint}）。主持人用**[主持人姓名]**标记，嘉宾用**[嘉宾姓名]**标记。绝对不要用"嘉宾""真名""说话人"等泛称。
3. 换人说话必须另起一行
4. 保留[MM:SS]时间戳
5. 不改变原意
6. 修正语音识别错误
只输出文稿，不要任何解释。`;
}

async function repolishEpisode(db, episodeId) {
  // Get episode info
  const ep = db.prepare(`
    SELECT e.id, e.title, e.guests, p.name as podcast_name, p.host
    FROM episodes e JOIN podcasts p ON p.id=e.podcast_id
    WHERE e.id=?
  `).get(episodeId);
  if (!ep) { console.log(`Episode ${episodeId} not found`); return false; }

  // Get raw ASR transcript
  const raw = db.prepare(`
    SELECT content FROM transcripts
    WHERE episode_id=? AND source IN ('asr','manual')
    ORDER BY CASE WHEN source='asr' THEN 0 ELSE 1 END
    LIMIT 1
  `).get(episodeId);
  if (!raw) { console.log(`  No raw transcript for episode ${episodeId}`); return false; }

  console.log(`  Title: ${ep.title.slice(0, 60)}`);
  console.log(`  Podcast: ${ep.podcast_name}, Host: ${ep.host || '?'}, Guests: ${ep.guests || '?'}`);
  console.log(`  Raw length: ${(raw.content.length / 1000).toFixed(0)}k chars`);

  const sys = makePrompt(ep.podcast_name, ep.host, ep.guests);

  // Chunk the raw transcript
  const lines = raw.content.split('\n');
  const chunks = []; let cur = '';
  for (const l of lines) {
    if (cur.length + l.length > CHUNK_SIZE && cur.length > 0) { chunks.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + l;
  }
  if (cur) chunks.push(cur);

  console.log(`  Chunks: ${chunks.length}`);

  // Polish each chunk
  const results = [];
  let speakerCtx = '';
  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(`  Polishing chunk ${i+1}/${chunks.length}... `);
    let hint = '';
    if (i > 0 && speakerCtx) hint = `\n\n(Part ${i+1}/${chunks.length}. 使用这些说话人名字: ${speakerCtx})`;
    const polished = await callLLM(sys, chunks[i] + hint);
    results.push(polished);

    // Extract speaker names for context
    const names = new Set(); let m;
    const re = /\*\*\[([^\]]+)\]\*\*/g;
    while ((m = re.exec(polished)) !== null) names.add(m[1]);
    if (names.size > 0) speakerCtx = [...names].join(', ');
    console.log(`OK (speakers: ${speakerCtx})`);
  }

  let content = results.join('\n\n');

  // Normalize format
  content = content.replace(/\*\*([^*\[\]]{1,20})\*\*[：:]\s*/g, '**[$1]** ');
  content = content.replace(/\*\*([^*\[\]]{1,20})\*\*(\s)/g, (m, n, s) => '**[' + n.trim() + ']**' + s);
  content = content.replace(/\*\*\[([^\]]+)\]\s*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\*\*/g, '**[$1]** [$2]');
  content = content.replace(/^\*\*\[[^\]]+\]\*\*\s*$/gm, '').replace(/\n{3,}/g, '\n\n');

  // Replace generic labels
  const tc = {}; const tre = /\*\*\[([^\]]+)\]\*\*/g; let tm;
  while ((tm = tre.exec(content)) !== null) tc[tm[1]] = (tc[tm[1]]||0)+1;
  const generic = ['嘉宾','Guest','嘉宾A','嘉宾B','Guest A','Guest B','对话者','受访者','访谈者','Interviewer','Interviewee','真名','RealName','说话人','Speaker'];
  const real = Object.entries(tc).filter(([n])=>!generic.includes(n)&&!['主持人','Host'].includes(n)).sort((a,b)=>b[1]-a[1]);
  if (real.length >= 1) {
    for (const g of generic) {
      if (tc[g]) content = content.replace(new RegExp('\\*\\*\\['+g.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\]\\*\\*','g'), '**['+real[0][0]+']**');
    }
  }

  // Normalize host label variants (e.g. "主持人 WhynotTV", "主持人: Name") -> "主持人"
  const hostVariants = /\*\*\[主持人[：:\s]+[^\]]*\]\*\*/g;
  content = content.replace(hostVariants, '**[主持人]**');

  // Count remaining issues
  const finalTc = {};
  const fre = /\*\*\[([^\]]+)\]\*\*/g;
  while ((tm = fre.exec(content)) !== null) finalTc[tm[1]] = (finalTc[tm[1]]||0)+1;

  // If podcast host name appears as a standalone speaker, merge into 主持人
  if (ep.host && finalTc[ep.host] && finalTc['主持人']) {
    content = content.replace(new RegExp('\\*\\*\\[' + ep.host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]\\*\\*', 'g'), '**[主持人]**');
    finalTc['主持人'] = (finalTc['主持人'] || 0) + (finalTc[ep.host] || 0);
    delete finalTc[ep.host];
  }

  console.log(`  Speaker counts:`, finalTc);

  // Update in DB
  const existing = db.prepare("SELECT id FROM transcripts WHERE episode_id=? AND source='llm_polish'").get(episodeId);
  if (existing) {
    db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(content, existing.id);
    console.log(`  Updated existing polish (id=${existing.id}), ${(content.length/1000).toFixed(0)}k chars`);
  } else {
    db.prepare("INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'zh', 'llm_polish')").run(episodeId, content);
    console.log(`  Created new polish, ${(content.length/1000).toFixed(0)}k chars`);
  }
  return true;
}

async function main() {
  const ids = process.argv.slice(2).map(Number).filter(Boolean);
  if (ids.length === 0) {
    console.log('Usage: node scripts/repolish.js <episode_id> [episode_id...]');
    console.log('\nEpisodes with [真名] placeholder:');
    const db = getDb();
    const bad = db.prepare(`
      SELECT t.episode_id, e.title,
             (LENGTH(t.content) - LENGTH(REPLACE(t.content, '真名', ''))) / 2 as count
      FROM transcripts t JOIN episodes e ON e.id=t.episode_id
      WHERE t.source='llm_polish' AND t.content LIKE '%真名%'
      ORDER BY count DESC LIMIT 20
    `).all();
    for (const r of bad) console.log(`  ${r.episode_id}: ${r.count}x [真名] - ${r.title.slice(0,60)}`);
    closeDb();
    return;
  }

  const db = getDb();
  const start = Date.now();
  let done = 0;
  for (const id of ids) {
    console.log(`\n[${done+1}/${ids.length}] Re-polishing episode ${id}...`);
    try {
      const ok = await repolishEpisode(db, id);
      if (ok) done++;
    } catch(e) {
      console.log(`  ERROR: ${e.message.slice(0, 100)}`);
    }
  }
  console.log(`\nDone: ${done}/${ids.length} in ${((Date.now()-start)/60000).toFixed(1)}m`);
  closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
