/**
 * Fix episodes with low speaker tag coverage.
 * Re-processes polished transcripts with a focused prompt to add missing tags.
 */
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');
const db = getDb();

const API_KEY = 'sk-3ODOY96LmDCFgcBY1d1b586c01E448BcAbB5115bD8FbD2Fc';
const API_URL = 'http://38.246.250.87:3000/v1/chat/completions';
const CHUNK_SIZE = 3000;

// Get episode info for prompt context
function getEpInfo(epId) {
  const ep = db.prepare('SELECT title, podcast_id FROM episodes WHERE id=?').get(epId);
  const pod = db.prepare('SELECT name, host FROM podcasts WHERE id=?').get(ep?.podcast_id);
  return { title: ep?.title, podcast: pod?.name, host: pod?.host };
}

async function callLLM(sys, text) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: sys }, { role: 'user', content: text }], max_tokens: 4096 })
      });
      if (r.status === 429) { await new Promise(r => setTimeout(r, 5000 * (i + 1))); continue; }
      if (!r.ok) throw new Error(`API ${r.status}`);
      const d = await r.json();
      return d?.choices?.[0]?.message?.content || text;
    } catch (e) { if (i === 2) throw e; await new Promise(r => setTimeout(r, 3000)); }
  }
}

async function fixEpisode(trId, epId) {
  const tr = db.prepare('SELECT content FROM transcripts WHERE id=?').get(trId);
  const info = getEpInfo(epId);

  // Extract existing speaker names from the content
  const existingTags = {};
  const re = /\*\*\[([^\]]+)\]\*\*/g;
  let m;
  while ((m = re.exec(tr.content)) !== null) existingTags[m[1]] = (existingTags[m[1]] || 0) + 1;
  const speakers = Object.keys(existingTags).join(', ');

  const sys = `你是播客文字稿编辑器。以下文字稿有些段落缺少说话人标签。请为每一个段落添加正确的说话人标签。

已知说话人：${speakers}
播客：${info.podcast}，主持人：${info.host}
本期标题：${info.title}

规则：
1. 每个段落开头必须有 **[说话人名]** 标签
2. 已有标签的段落保持不变
3. 根据上下文（提问→主持人，回答/阐述→嘉宾）判断说话人
4. 不要改变原文内容，只添加缺失的说话人标签
5. 保留所有 [MM:SS] 时间戳

只输出完整的修正后文稿。`;

  const lines = tr.content.split('\n');
  const chunks = [];
  let cur = '';
  for (const l of lines) {
    if (cur.length + l.length > CHUNK_SIZE && cur.length > 0) { chunks.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + l;
  }
  if (cur) chunks.push(cur);

  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    const hint = i > 0 ? `\n\n(Part ${i + 1}/${chunks.length}, speakers: ${speakers})` : '';
    const fixed = await callLLM(sys, chunks[i] + hint);
    results.push(fixed);
  }

  let content = results.join('\n\n');
  // Normalize tags
  content = content.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*[：:]\s*/g, '$1**[$2]** ');
  content = content.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*(\s)/g, (m, pre, name, sp) => pre + '**[' + name.trim() + ']**' + sp);
  content = content.replace(/\*\*\[张小珺Jùn\]\*\*/g, '**[张小珺]**');
  content = content.replace(/\*\*\[朱孝虎\]\*\*/g, '**[朱啸虎]**');
  content = content.replace(/^\*\*\[[^\]]+\]\*\*\s*$/gm, '').replace(/\n{3,}/g, '\n\n');

  db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(content, trId);

  // Check coverage after fix
  const newLines = content.split('\n').filter(l => l.trim() && l.length > 10);
  const tagged = newLines.filter(l => l.match(/\*\*\[/));
  return { chunks: chunks.length, coverage: Math.round(tagged.length / newLines.length * 100) };
}

async function main() {
  // Find Chinese polished transcripts with low speaker tag coverage
  const targetIds = process.argv.slice(2).map(Number).filter(Boolean);

  let episodes;
  if (targetIds.length > 0) {
    episodes = targetIds.map(epId => {
      const tr = db.prepare("SELECT id, episode_id FROM transcripts WHERE episode_id=? AND source='llm_polish'").get(epId);
      return tr;
    }).filter(Boolean);
  } else {
    // Find all with <60% coverage
    const all = db.prepare(`
      SELECT t.id, t.episode_id, t.content
      FROM transcripts t
      JOIN episodes e ON e.id = t.episode_id
      JOIN podcasts p ON p.id = e.podcast_id
      WHERE t.source = 'llm_polish' AND p.language LIKE 'zh%'
    `).all();

    episodes = all.filter(t => {
      const lines = t.content.split('\n').filter(l => l.trim() && l.length > 10);
      const tagged = lines.filter(l => l.match(/\*\*\[/));
      return lines.length > 10 && tagged.length / lines.length < 0.6;
    }).map(t => ({ id: t.id, episode_id: t.episode_id }));
  }

  console.log(`\n🏷️ Fix Missing Tags: ${episodes.length} episodes\n`);

  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i];
    const epInfo = db.prepare('SELECT title FROM episodes WHERE id=?').get(ep.episode_id);
    process.stdout.write(`[${i + 1}/${episodes.length}] ep${ep.episode_id} ${epInfo?.title?.slice(0, 40)}... `);
    try {
      const result = await fixEpisode(ep.id, ep.episode_id);
      console.log(`OK (${result.chunks}ch, ${result.coverage}%)`);
    } catch (e) {
      console.log(`FAIL: ${e.message.slice(0, 60)}`);
    }
  }

  closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
