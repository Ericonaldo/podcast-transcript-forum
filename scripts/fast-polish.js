#!/usr/bin/env node
/**
 * Fast batch polish - processes episodes concurrently for speed.
 * Skips >300k char transcripts. Processes 2 episodes concurrently.
 */
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');

const API_KEY = 'sk-3ODOY96LmDCFgcBY1d1b586c01E448BcAbB5115bD8FbD2Fc';
const API_URL = 'http://38.246.250.87:3000/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
const CHUNK_SIZE = 3000;
const MAX_LEN = 300000;
const CONCURRENCY = 2;

function makePrompt(podcastName, isZh) {
  if (isZh) return `你是播客文字稿编辑器。优化原始语音转录为可读文字稿。
要求：1.添加标点 2.识别说话人，用**[真名]**标记（播客:${podcastName}，不要用"嘉宾"这种泛称，根据上下文推断真名） 3.换人说话另起一行 4.保留[MM:SS]时间戳 5.不改原意 6.修正语音识别错误
只输出文稿。`;
  return `Podcast transcript editor. Polish raw STT into readable text.
Rules: 1.Add punctuation 2.Label speakers as **[RealName]** (Podcast:${podcastName}, infer names from context, never use generic "Guest") 3.New line per speaker turn 4.Keep [MM:SS] timestamps 5.Don't change meaning 6.Fix STT errors
Output only transcript.`;
}

function vttToPlain(content) {
  const cues = [];
  for (const block of content.split(/\n\s*\n/)) {
    const lines = block.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length || /^(WEBVTT|NOTE|STYLE|Kind:|Language:)/.test(lines[0])) continue;
    const ti = lines.findIndex(l => l.includes('-->'));
    if (ti === -1) continue;
    const m = lines[ti].match(/([\d:.]+)/);
    const secs = m ? m[1].split(':').reduce((a,v,i,arr) => a+parseFloat(v)*Math.pow(60,arr.length-1-i),0) : 0;
    const text = lines.slice(ti+1).map(l => l.replace(/<\d{1,2}:\d{2}:\d{2}[.,]\d{3}>/g,'').replace(/<\/?[a-z][^>]*>/gi,'').trim()).filter(Boolean).join(' ');
    if (text) cues.push({secs, text});
  }
  if (!cues.length) return content;
  const groups = [];
  let ws = cues[0].secs, wt = [], wts = Math.floor(cues[0].secs/60)+':'+String(Math.floor(cues[0].secs%60)).padStart(2,'0');
  for (const c of cues) {
    if (c.secs - ws >= 60 && wt.length) {
      groups.push('['+wts+'] '+wt.join(' '));
      ws = c.secs; wt = []; wts = Math.floor(c.secs/60)+':'+String(Math.floor(c.secs%60)).padStart(2,'0');
    }
    wt.push(c.text);
  }
  if (wt.length) groups.push('['+wts+'] '+wt.join(' '));
  return groups.join('\n');
}

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

async function polishOne(db, ep) {
  let plain = ep.format === 'vtt' ? vttToPlain(ep.content) : ep.content;
  if (plain.length > MAX_LEN) plain = plain.slice(0, MAX_LEN);

  const sys = makePrompt(ep.podcast_name, /^zh/.test(ep.language));
  const lines = plain.split('\n');
  const chunks = []; let cur = '';
  for (const l of lines) {
    if (cur.length + l.length > CHUNK_SIZE && cur.length > 0) { chunks.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + l;
  }
  if (cur) chunks.push(cur);

  const results = [];
  let speakerCtx = '';
  for (let i = 0; i < chunks.length; i++) {
    let hint = '';
    if (i > 0 && speakerCtx) hint = '\n\n(Part '+(i+1)+'/'+chunks.length+'. Use these exact speaker names: '+speakerCtx+')';
    const polished = await callLLM(sys, chunks[i] + hint);
    results.push(polished);
    const names = new Set(); let m;
    const re = /\*\*\[([^\]]+)\]\*\*/g;
    while ((m = re.exec(polished)) !== null) names.add(m[1]);
    if (names.size > 0) speakerCtx = [...names].join(', ');
  }

  let content = results.join('\n\n');
  // Normalize format bugs
  // Fix **Name**：text -> **[Name]** text
  content = content.replace(/\*\*([^*\[\]]{1,20})\*\*[：:]\s*/g, '**[$1]** ');
  // Fix **Name** text -> **[Name]** text (no colon)
  content = content.replace(/\*\*([^*\[\]]{1,20})\*\*(\s)/g, (m, name, sp) => '**['+name.trim()+']**'+sp);
  // Fix **[Speaker] [MM:SS]** -> **[Speaker]** [MM:SS]
  content = content.replace(/\*\*\[([^\]]+)\]\s*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\*\*/g, '**[$1]** [$2]');
  // Remove empty speaker-only lines
  content = content.replace(/^\*\*\[[^\]]+\]\*\*\s*$/gm, '').replace(/\n{3,}/g, '\n\n');
  // Replace generic labels with real names
  const tc = {}; const tre = /\*\*\[([^\]]+)\]\*\*/g; let tm;
  while ((tm = tre.exec(content)) !== null) tc[tm[1]] = (tc[tm[1]]||0)+1;
  const generic = ['嘉宾','Guest','嘉宾A','嘉宾B','Guest A','Guest B','对话者','受访者','访谈者','Interviewer','Interviewee'];
  const real = Object.entries(tc).filter(([n])=>!generic.includes(n)&&!['主持人','Host'].includes(n)).sort((a,b)=>b[1]-a[1]);
  if (real.length >= 1) {
    for (const g of generic) {
      if (tc[g]) content = content.replace(new RegExp('\\*\\*\\['+g.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\]\\*\\*','g'), '**['+real[0][0]+']**');
    }
  }

  // Save
  const existing = db.prepare("SELECT id FROM transcripts WHERE episode_id=? AND source='llm_polish'").get(ep.episode_id);
  if (existing) {
    db.prepare('UPDATE transcripts SET content=?,format=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(content,'plain',existing.id);
  } else {
    db.prepare('INSERT INTO transcripts (episode_id,content,format,language,source) VALUES (?,?,?,?,?)').run(ep.episode_id,content,'plain',ep.language,'llm_polish');
  }
  return { chunks: chunks.length, len: content.length };
}

async function main() {
  const db = getDb();

  // Priority episode first
  const priorityIds = process.argv.slice(2).map(Number).filter(Boolean);

  const episodes = db.prepare(`
    SELECT t.episode_id, t.content, t.format, t.language,
           e.title, p.name as podcast_name, LENGTH(t.content) as len
    FROM transcripts t JOIN episodes e ON e.id=t.episode_id JOIN podcasts p ON p.id=e.podcast_id
    WHERE t.source != 'llm_polish'
    AND t.episode_id NOT IN (SELECT episode_id FROM transcripts WHERE source='llm_polish')
    AND LENGTH(t.content) < ?
    ORDER BY
      CASE WHEN t.episode_id IN (${priorityIds.map(()=>'?').join(',') || '0'}) THEN 0 ELSE 1 END,
      CASE WHEN t.language LIKE 'zh%' THEN 0 ELSE 1 END,
      LENGTH(t.content) ASC
  `).all(MAX_LEN, ...priorityIds);

  console.log(`\n📝 Fast Polish: ${episodes.length} episodes\n`);
  const start = Date.now();
  let done = 0, failed = 0;

  // Process with concurrency
  let i = 0;
  async function worker() {
    while (i < episodes.length) {
      const idx = i++;
      const ep = episodes[idx];
      const elapsed = ((Date.now()-start)/60000).toFixed(1);
      process.stdout.write(`[${idx+1}/${episodes.length}] (${elapsed}m) ${ep.podcast_name.slice(0,12)} | ${ep.title.slice(0,40)}... `);
      try {
        const r = await polishOne(db, ep);
        console.log(`OK (${r.chunks}ch, ${(r.len/1000).toFixed(0)}k)`);
        done++;
      } catch(e) {
        console.log(`FAIL: ${e.message.slice(0,60)}`);
        failed++;
      }
    }
  }

  await Promise.all(Array.from({length: CONCURRENCY}, () => worker()));
  console.log(`\n✅ ${((Date.now()-start)/60000).toFixed(1)}m: ${done} done, ${failed} failed`);
  closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
