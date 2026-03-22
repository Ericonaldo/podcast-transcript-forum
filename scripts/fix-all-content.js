/**
 * Comprehensive fix for ALL polished transcripts:
 * 1. Fix known name errors (朱孝虎→朱啸虎, 张小珺Jùn→张小珺, etc.)
 * 2. Fix tag format issues (**Name**: → **[Name]**)
 * 3. Report episodes with low speaker tag coverage (missing diarization)
 */
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');
const db = getDb();

// Known name fixes (wrong → correct)
const NAME_FIXES = {
  '朱孝虎': '朱啸虎',
  '张小珺Jùn': '张小珺',
  '张小珺Jun': '张小珺',
  '泓君': '泓君',  // keep as-is (硅谷101 host)
};

const all = db.prepare("SELECT id, episode_id, content FROM transcripts WHERE source='llm_polish'").all();
console.log(`Checking ${all.length} polished transcripts...\n`);

let fixedCount = 0;
const lowCoverage = [];

for (const tr of all) {
  let c = tr.content;
  const orig = c;

  // 1. Fix known name errors
  for (const [wrong, correct] of Object.entries(NAME_FIXES)) {
    if (c.includes(wrong)) {
      c = c.replace(new RegExp('\\*\\*\\[' + wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]\\*\\*', 'g'), '**[' + correct + ']**');
    }
  }

  // 2. Fix tag formats
  // **Name**: → **[Name]**
  c = c.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*[：:]\s*/g, '$1**[$2]** ');
  // **Name** text → **[Name]** text (at line start)
  c = c.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*(\s)/g, (m, pre, name, sp) => pre + '**[' + name.trim() + ']**' + sp);
  // **[Speaker] [MM:SS]** → **[Speaker]** [MM:SS]
  c = c.replace(/\*\*\[([^\]]+)\]\s*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\*\*/g, '**[$1]** [$2]');
  // **[MM:SS] Name** → **[Name]** [MM:SS]
  c = c.replace(/\*\*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\s*([^*]{1,30}?)\*\*[：:]*\s*/g, '**[$2]** [$1] ');
  // Empty speaker lines
  c = c.replace(/^\*\*\[[^\]]+\]\*\*\s*$/gm, '').replace(/\n{3,}/g, '\n\n');

  if (c !== orig) {
    db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(c, tr.id);
    fixedCount++;
  }

  // 3. Check speaker tag coverage
  const lines = c.split('\n').filter(l => l.trim() && l.length > 10);
  const taggedLines = lines.filter(l => l.match(/\*\*\[[^\]]+\]\*\*/));
  const coverage = lines.length > 0 ? taggedLines.length / lines.length : 1;
  if (coverage < 0.5 && lines.length > 10) {
    lowCoverage.push({
      epId: tr.episode_id,
      lines: lines.length,
      tagged: taggedLines.length,
      coverage: Math.round(coverage * 100),
    });
  }
}

console.log(`Fixed format/names in ${fixedCount} transcripts\n`);

if (lowCoverage.length > 0) {
  console.log(`Episodes with LOW speaker tag coverage (<50%):`);
  lowCoverage.sort((a, b) => a.coverage - b.coverage);
  lowCoverage.forEach(e => {
    const ep = db.prepare('SELECT title FROM episodes WHERE id=?').get(e.epId);
    console.log(`  ep${e.epId} (${e.coverage}%): ${e.tagged}/${e.lines} tagged | ${ep?.title?.slice(0, 50)}`);
  });
}

closeDb();
