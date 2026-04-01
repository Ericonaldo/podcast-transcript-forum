#!/usr/bin/env node
/**
 * Fix missing/malformed speaker tags in polished transcripts
 * Handles: **Name:** -> **[Name]**, inline "Name:" -> **[Name]**, missing tags
 */
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');

const args = process.argv.slice(2);
const episodeId = args.find(a => a.startsWith('--episode-id='))?.split('=')[1];

const db = getDb();

const where = episodeId ? `AND t.episode_id=${parseInt(episodeId)}` : '';
const transcripts = db.prepare(`
  SELECT t.id, t.episode_id, t.content, e.title
  FROM transcripts t
  JOIN episodes e ON e.id = t.episode_id
  WHERE t.source = 'llm_polish' ${where}
`).all();

console.log(`Fixing speaker tags in ${transcripts.length} transcripts...\n`);
let fixed = 0;

for (const tr of transcripts) {
  let content = tr.content;
  const orig = content;

  // Step 1: Extract known speakers from existing proper tags
  const speakers = new Set();
  const tagRe = /\*\*\[([^\]]+)\]\*\*/g;
  let m;
  while ((m = tagRe.exec(content)) !== null) {
    speakers.add(m[1]);
  }

  // Step 2: Fix **Name:** or **Name：** -> **[Name]** (anywhere in text)
  content = content.replace(/\*\*([^*\n]{1,50}?)[：:]\*\*/g, (match, name) => {
    speakers.add(name.trim());
    return `**[${name.trim()}]**`;
  });
  content = content.replace(/\*\*([^*\n]{1,50}?)\*\*[：:]\s*/g, (match, name) => {
    speakers.add(name.trim());
    return `**[${name.trim()}]** `;
  });

  // Step 3: Fix inline "Name:" patterns for known speakers (mid-paragraph)
  if (speakers.size > 0) {
    for (const speaker of speakers) {
      const escaped = speaker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match "Name:" anywhere (start of line, after period, or mid-text)
      const inlineRe = new RegExp(`(^|\\n|\\. |, )${escaped}:\\s+`, 'gm');
      content = content.replace(inlineRe, (match, prefix) => {
        if (prefix === '\n' || prefix === '') return `**[${speaker}]** `;
        if (prefix === '. ' || prefix === ', ') return prefix + `\n\n**[${speaker}]** `;
        return prefix + `**[${speaker}]** `;
      });
    }
  }

  // Step 4: Fix **Name** (no brackets, no colon) at line start -> **[Name]**
  content = content.replace(/(^|\n)\*\*([^*\[\]\n]{1,50}?)\*\*(\s+[A-Z])/g, '$1**[$2]**$3');

  // Step 5: Remove colons after proper tags
  content = content.replace(/\*\*\[([^\]]+)\]\*\*[：:]\s*/g, '**[$1]** ');

  if (content !== orig) {
    db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(content, tr.id);
    console.log(`✓ Episode ${tr.episode_id}: ${tr.title.slice(0, 50)}`);
    fixed++;
  }
}

console.log(`\n✅ Fixed: ${fixed}/${transcripts.length}`);
closeDb();
