#!/usr/bin/env node
/**
 * Verify speaker tags in all polished transcripts
 */
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');

const db = getDb();

const transcripts = db.prepare(`
  SELECT t.id, t.episode_id, t.content, e.title
  FROM transcripts t
  JOIN episodes e ON e.id = t.episode_id
  WHERE t.source = 'llm_polish'
`).all();

console.log(`Checking ${transcripts.length} transcripts...\n`);

let issues = 0;
const problematic = [];

for (const tr of transcripts) {
  const malformed = (tr.content.match(/\*\*[^*\[\]]{1,50}?[：:]\*\*/g) || []).length;
  if (malformed > 0) {
    issues++;
    problematic.push({ id: tr.episode_id, title: tr.title.slice(0, 50), count: malformed });
  }
}

if (problematic.length > 0) {
  console.log(`Found ${issues} episodes with malformed tags:\n`);
  problematic.slice(0, 20).forEach(p => {
    console.log(`  Episode ${p.id}: ${p.title} (${p.count} issues)`);
  });
  if (problematic.length > 20) {
    console.log(`  ... and ${problematic.length - 20} more`);
  }
} else {
  console.log('✅ All transcripts have proper speaker tags!');
}

closeDb();
