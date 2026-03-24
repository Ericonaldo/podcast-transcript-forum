require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');
const db = getDb();

const eps = db.prepare(`
  SELECT e.id, e.title, t.content, t.source
  FROM episodes e JOIN transcripts t ON t.episode_id=e.id
  WHERE e.podcast_id=16 AND t.source IN ('asr','llm_polish')
  ORDER BY e.id, t.source DESC
`).all();

console.log('Checking 张小珺 transcripts for wrong content...\n');
const seen = new Set();
let wrongCount = 0;
for (const ep of eps) {
  if (seen.has(ep.id)) continue;
  seen.add(ep.id);
  const first300 = ep.content.slice(0, 300);
  const hasZXJ = first300.includes('小珺') || first300.includes('张小');
  // Extract guest name from title
  const guestMatch = ep.title.match(/[和对与](.{2,6})[聊的创口述]/);
  const titleGuest = guestMatch ? guestMatch[1] : '';
  const hasGuest = titleGuest && first300.includes(titleGuest.slice(0, 2));

  if (!hasZXJ && !hasGuest && ep.content.length > 500) {
    console.log('❌ ep' + ep.id + ' [' + ep.source + ']: WRONG CONTENT');
    console.log('   Title: ' + ep.title.slice(0, 50));
    console.log('   Start: ' + first300.slice(0, 120));
    console.log('');
    wrongCount++;
  }
}
console.log(wrongCount + ' suspicious episodes found');
closeDb();
