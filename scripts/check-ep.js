require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');
const db = getDb();

const epId = process.argv[2] || 99;
const tr = db.prepare("SELECT content, source FROM transcripts WHERE episode_id=? AND source='llm_polish'").get(epId);
if (!tr) {
  console.log('No polished transcript for ep' + epId);
  closeDb();
  process.exit(0);
}

const lines = tr.content.split('\n').filter(l => l.trim());

// Find all unique speaker tags
const tags = {};
const re = /\*\*\[([^\]]+)\]\*\*/g;
let m;
while ((m = re.exec(tr.content)) !== null) tags[m[1]] = (tags[m[1]] || 0) + 1;
console.log('Speaker tags:', tags);

// Find lines with ** but NOT in **[...]** format
const rawStars = lines.filter(l => l.includes('**') && !l.match(/\*\*\[[^\]]+\]\*\*/));
console.log('\nLines with raw ** (not bracketed):', rawStars.length);
rawStars.slice(0, 10).forEach(l => console.log('  ', l.slice(0, 150)));

// Find lines with broken patterns
const broken = lines.filter(l => {
  // odd number of **
  return (l.match(/\*\*/g) || []).length % 2 !== 0;
});
console.log('\nLines with odd ** count:', broken.length);
broken.slice(0, 5).forEach(l => console.log('  ', l.slice(0, 150)));

// Show first 10 lines
console.log('\nFirst 10 lines:');
lines.slice(0, 10).forEach((l, i) => console.log('  ' + (i+1) + ':', l.slice(0, 120)));

closeDb();
