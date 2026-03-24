require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');
const db = getDb();

const API_KEY = 'sk-3ODOY96LmDCFgcBY1d1b586c01E448BcAbB5115bD8FbD2Fc';
const API_URL = 'http://38.246.250.87:3000/v1/chat/completions';

// Get the original VTT transcript (more accurate than ASR for this episode)
const raw = db.prepare("SELECT content, source FROM transcripts WHERE episode_id=166 ORDER BY CASE WHEN source='youtube_manual' THEN 0 WHEN source='asr' THEN 1 ELSE 2 END LIMIT 1").get();
console.log('Using source:', raw.source, '|', raw.content.length, 'chars');

// Parse VTT to plain text if needed
let plainText = raw.content;
if (raw.source.includes('youtube') || raw.source === 'vtt') {
  const cues = [];
  for (const block of raw.content.split(/\n\s*\n/)) {
    const lines = block.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length || /^(WEBVTT|NOTE|STYLE|Kind:|Language:)/.test(lines[0])) continue;
    const ti = lines.findIndex(l => l.includes('-->'));
    if (ti === -1) continue;
    const m = lines[ti].match(/([\d:.]+)/);
    const secs = m ? m[1].split(':').reduce((a, v, i, arr) => a + parseFloat(v) * Math.pow(60, arr.length - 1 - i), 0) : 0;
    const text = lines.slice(ti + 1).map(l => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join(' ');
    if (text) cues.push({ secs, text });
  }
  const groups = [];
  if (cues.length) {
    let ws = cues[0].secs, wt = [];
    for (const c of cues) {
      if (c.secs - ws >= 60 && wt.length) {
        groups.push(`[${Math.floor(ws / 60)}:${String(Math.floor(ws % 60)).padStart(2, '0')}] ${wt.join(' ')}`);
        ws = c.secs; wt = [];
      }
      wt.push(c.text);
    }
    if (wt.length) groups.push(`[${Math.floor(ws / 60)}:${String(Math.floor(ws % 60)).padStart(2, '0')}] ${wt.join(' ')}`);
    plainText = groups.join('\n');
  }
}

console.log('Plain text:', plainText.length, 'chars');

const sys = `你是播客文字稿编辑器。这是「罗永浩的十字路口」播客，本期嘉宾是**周鸿祎**（360创始人）。

关键识别规则（非常重要，请严格遵守）：
- **罗永浩**是主持人。他的特征：提出问题、引导话题、简短回应（"对""没错""是"）、分享自己的创业经历、提到锤子/T1/手机/网红经历
- **周鸿祎**是嘉宾。他的特征：详细回答问题、讲述360的故事、分享AI观点、讲述自己做网红/直播/造车的经历、提到"我们公司""360""智能汽车"
- 当内容是**提问或话题转换**时 → 一定是**罗永浩**
- 当内容是**长篇阐述、回答问题、讲述经验**时 → 一定是**周鸿祎**
- 同一人连续说话不要换人
- 每段必须以 **[罗永浩]** 或 **[周鸿祎]** 开头

输出要求：1.添加标点 2.用**[罗永浩]**和**[周鸿祎]**标记 3.换人另起一行 4.保留[MM:SS]时间戳 5.不改原意
只输出文稿。`;

const CHUNK = 3000;
const lines = plainText.split('\n');
const chunks = [];
let cur = '';
for (const l of lines) {
  if (cur.length + l.length > CHUNK && cur.length > 0) { chunks.push(cur); cur = ''; }
  cur += (cur ? '\n' : '') + l;
}
if (cur) chunks.push(cur);
console.log('Chunks:', chunks.length);

async function callLLM(text) {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: sys }, { role: 'user', content: text }], max_tokens: 4096 })
  });
  if (!r.ok) throw new Error('API ' + r.status);
  const d = await r.json();
  return d?.choices?.[0]?.message?.content || text;
}

(async () => {
  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write('C' + (i + 1) + '/' + chunks.length + ' ');
    const hint = i > 0 ? '\n\n(Part ' + (i + 1) + '/' + chunks.length + '. 只有罗永浩和周鸿祎两人。罗永浩=主持人提问，周鸿祎=嘉宾回答)' : '';
    const p = await callLLM(chunks[i] + hint);
    results.push(p);
    process.stdout.write('ok ');
  }

  let content = results.join('\n\n');
  // Normalize
  content = content.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*[：:]\s*/g, '$1**[$2]** ');
  content = content.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*(\s)/g, (m, pre, name, sp) => pre + '**[' + name.trim() + ']**' + sp);
  content = content.replace(/\*\*\[([^\]]+)\]\s*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\*\*/g, '**[$1]** [$2]');
  content = content.replace(/^\*\*\[[^\]]+\]\*\*\s*$/gm, '').replace(/\n{3,}/g, '\n\n');

  // Update existing polish
  const existing = db.prepare("SELECT id FROM transcripts WHERE episode_id=166 AND source='llm_polish'").get();
  if (existing) {
    db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(content, existing.id);
  } else {
    db.prepare("INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (166, ?, 'plain', 'zh', 'llm_polish')").run(content);
  }

  const tags = {};
  const re = /\*\*\[([^\]]+)\]\*\*/g;
  let m;
  while ((m = re.exec(content)) !== null) tags[m[1]] = (tags[m[1]] || 0) + 1;
  console.log('\nSaved:', content.length, 'chars | Tags:', tags);
  closeDb();
})();
