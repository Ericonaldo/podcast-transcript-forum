/**
 * Fix ALL polished transcripts: normalize speaker tag format.
 * **Name**: text -> **[Name]** text
 * **Name** text -> **[Name]** text
 */
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');
const db = getDb();

const all = db.prepare("SELECT id, episode_id, content FROM transcripts WHERE source='llm_polish'").all();
console.log('Checking', all.length, 'polished transcripts...');

let fixed = 0;
for (const tr of all) {
  let c = tr.content;
  const orig = c;

  // Fix **[MM:SS] Name**: text -> **[Name]** [MM:SS] text
  c = c.replace(/\*\*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\s*([^*]{1,30}?)\*\*[：:]*\s*/g, '**[$2]** [$1] ');
  // Fix **Name**：text or **Name**: text -> **[Name]** text (only at line start or after timestamp)
  c = c.replace(/(^|\n|\] )\*\*([^*\[\]\n]{1,30}?)\*\*[：:]\s*/g, '$1**[$2]** ');
  // Fix **Name** at line start (no colon, followed by space/CJK)
  c = c.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*(\s)/g, (m, pre, name, sp) => pre + '**[' + name.trim() + ']**' + sp);
  // Fix **[Speaker] [MM:SS]** -> **[Speaker]** [MM:SS]
  c = c.replace(/\*\*\[([^\]]+)\]\s*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\*\*/g, '**[$1]** [$2]');
  // Remove empty speaker-only lines
  c = c.replace(/^\*\*\[[^\]]+\]\*\*\s*$/gm, '').replace(/\n{3,}/g, '\n\n');

  // Normalize podcast-specific name variants
  c = c.replace(/\*\*\[张小珺Jùn\]\*\*/g, '**[张小珺]**');
  c = c.replace(/\*\*\[张小珺Jun\]\*\*/g, '**[张小珺]**');

  if (c !== orig) {
    db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(c, tr.id);
    fixed++;

    // Verify no remaining raw ** bugs
    const remaining = c.split('\n').filter(l => l.includes('**') && !l.match(/\*\*\[[^\]]+\]\*\*/));
    if (remaining.length > 0) {
      console.log('  ep' + tr.episode_id + ': fixed but ' + remaining.length + ' raw ** remain');
      console.log('    Sample:', remaining[0].slice(0, 100));
    }
  }
}

console.log('\nFixed', fixed, 'transcripts');

// Summary: check remaining issues
const postCheck = db.prepare("SELECT id, episode_id, content FROM transcripts WHERE source='llm_polish'").all();
let totalBugs = 0;
for (const tr of postCheck) {
  const bugs = tr.content.split('\n').filter(l => l.includes('**') && !l.match(/\*\*\[[^\]]+\]\*\*/));
  if (bugs.length > 0) {
    console.log('  ep' + tr.episode_id + ': ' + bugs.length + ' remaining bugs');
    totalBugs += bugs.length;
  }
}
console.log('Total remaining bugs across all transcripts:', totalBugs);

closeDb();
