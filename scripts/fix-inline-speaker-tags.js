#!/usr/bin/env node
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');
const { countInlineSpeakerTags, fixInlineSpeakerTags } = require('./lib/transcript-inline-speaker');

const args = process.argv.slice(2);
const podcastId = Number(args.find(arg => arg.startsWith('--podcast-id='))?.split('=')[1] || 0);
const episodeId = Number(args.find(arg => arg.startsWith('--episode-id='))?.split('=')[1] || 0);

const db = getDb();

try {
  let where = `WHERE t.source='llm_polish'`;
  if (podcastId) where += ` AND e.podcast_id=${podcastId}`;
  if (episodeId) where += ` AND e.id=${episodeId}`;

  const rows = db.prepare(`
    SELECT t.id, t.episode_id, t.content, e.title, p.name AS podcast_name
    FROM transcripts t
    JOIN episodes e ON e.id=t.episode_id
    JOIN podcasts p ON p.id=e.podcast_id
    ${where}
    ORDER BY e.id
  `).all();

  let fixedCount = 0;
  for (const row of rows) {
    const before = countInlineSpeakerTags(row.content);
    if (!before) continue;

    const fixed = fixInlineSpeakerTags(row.content);
    const after = countInlineSpeakerTags(fixed);

    db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(fixed, row.id);
    fixedCount += 1;
    console.log(`ep${row.episode_id} | ${row.podcast_name} | ${before} -> ${after} | ${row.title}`);
  }

  console.log(`\nFixed transcripts: ${fixedCount}`);
} finally {
  closeDb();
}
