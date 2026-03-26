#!/usr/bin/env node
/**
 * Post-processing for ALL polished transcripts:
 * 1. Remove leaked LLM prompt hints (Part X/Y, Use these exact names, etc.)
 * 2. Remove empty/speaker-only lines
 * 3. Merge consecutive same-speaker paragraphs
 * 4. Remove stray colons after speaker tags
 * 5. Normalize tag format
 *
 * Usage: node scripts/postprocess-polish.js [--episode-id=96]
 */
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');

const args = process.argv.slice(2);
const episodeId = args.find(a => a.startsWith('--episode-id='))?.split('=')[1];

const db = getDb();

const where = episodeId ? `AND t.episode_id=${parseInt(episodeId)}` : '';
const transcripts = db.prepare(`
  SELECT t.id, t.episode_id, t.content
  FROM transcripts t
  WHERE t.source = 'llm_polish' ${where}
`).all();

console.log(`Post-processing ${transcripts.length} polished transcripts...\n`);
let fixed = 0;

for (const tr of transcripts) {
  let content = tr.content;
  const orig = content;

  // 1. Remove leaked LLM prompt hints
  content = content.replace(/\(Part \d+\/\d+\..*?\)/g, '');
  content = content.replace(/\(Use these exact names:.*?\)/g, '');
  content = content.replace(/\(第\d+\/\d+段.*?\)/g, '');
  content = content.replace(/\(Speakers?:.*?\)/g, '');

  // 2. Fix **[MM:SS] [Name]** → **[Name]** (timestamp inside tag)
  content = content.replace(/\*\*\[\d{1,3}:\d{2}\]\s*\[([^\]]+)\]\*\*/g, '**[$1]**');
  content = content.replace(/\[\d{1,3}:\d{2}\]\s*\*\*\[([^\]]+)\]\*\*/g, '**[$1]**');
  content = content.replace(/\*\*\[\d{1,3}:\d{2}\]\*\*/g, '');

  // 3. Remove stray colons after speaker tags
  content = content.replace(/\*\*\[([^\]]+)\]\*\*[：:]\s*/g, '**[$1]** ');

  // 3. Normalize tag format
  content = content.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*[：:]\s*/g, '$1**[$2]** ');
  content = content.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*(\s)/g, (m, pre, name, sp) => pre + '**[' + name.trim() + ']**' + sp);

  // 4. Remove empty/speaker-only lines
  content = content.replace(/^\*\*\[[^\]]+\]\*\*\s*$/gm, '');

  // 5. Merge consecutive same-speaker paragraphs
  const lines = content.split('\n').filter(l => l.trim());
  const merged = [];
  let curSpeaker = null, curText = '';

  for (const line of lines) {
    const spMatch = line.match(/\*\*\[([^\]]+)\]\*\*/);
    const speaker = spMatch ? spMatch[1] : null;
    let text = line;
    if (spMatch) text = text.replace(/\*\*\[[^\]]+\]\*\*\s*/, '');
    text = text.replace(/^\[\d{1,3}:\d{2}\]\s*/, '').trim();
    if (!text) continue;

    if (speaker === curSpeaker || !speaker) {
      curText += ' ' + text;
    } else {
      if (curSpeaker && curText.trim()) {
        merged.push('**[' + curSpeaker + ']** ' + curText.trim());
      }
      curSpeaker = speaker;
      curText = text;
    }
  }
  if (curSpeaker && curText.trim()) {
    merged.push('**[' + curSpeaker + ']** ' + curText.trim());
  }

  content = merged.join('\n\n');

  if (content !== orig) {
    db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(content, tr.id);
    fixed++;
  }
}

console.log(`Fixed: ${fixed}/${transcripts.length}`);
closeDb();
