#!/usr/bin/env node
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');
const { countInlineSpeakerTags } = require('./lib/transcript-inline-speaker');

const db = getDb();

try {
  const rows = db.prepare(`
    SELECT
      p.id AS podcast_id,
      p.name AS podcast_name,
      e.id AS episode_id,
      e.title,
      t.id AS transcript_id,
      t.content
    FROM transcripts t
    JOIN episodes e ON e.id = t.episode_id
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE t.source = 'llm_polish'
    ORDER BY p.id, e.id
  `).all();

  const affected = [];
  const byPodcast = new Map();

  for (const row of rows) {
    const inlineCount = countInlineSpeakerTags(row.content);
    if (!inlineCount) continue;

    affected.push({
      podcastId: row.podcast_id,
      podcastName: row.podcast_name,
      episodeId: row.episode_id,
      title: row.title,
      inlineCount,
    });

    const current = byPodcast.get(row.podcast_id) || {
      podcastId: row.podcast_id,
      podcastName: row.podcast_name,
      episodeCount: 0,
      inlineCount: 0,
    };
    current.episodeCount += 1;
    current.inlineCount += inlineCount;
    byPodcast.set(row.podcast_id, current);
  }

  console.log(`Affected episodes: ${affected.length}`);
  console.log('');

  for (const summary of [...byPodcast.values()].sort((a, b) => b.inlineCount - a.inlineCount || a.podcastId - b.podcastId)) {
    console.log(
      `podcast ${summary.podcastId} | ${summary.podcastName} | episodes=${summary.episodeCount} | inline_tags=${summary.inlineCount}`
    );
  }

  if (affected.length) {
    console.log('\nTop affected episodes:');
    for (const item of affected.sort((a, b) => b.inlineCount - a.inlineCount || b.episodeId - a.episodeId).slice(0, 30)) {
      console.log(`ep${item.episodeId} | ${item.podcastName} | inline_tags=${item.inlineCount} | ${item.title}`);
    }
  }
} finally {
  closeDb();
}
