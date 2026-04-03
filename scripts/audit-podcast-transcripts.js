#!/usr/bin/env node
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');
const { auditEpisode, prioritizeEpisode } = require('./lib/podcast-transcript-audit');

const args = process.argv.slice(2);
const podcastId = Number(args.find(arg => arg.startsWith('--podcast-id='))?.split('=')[1] || 0);
const json = args.includes('--json');

if (!podcastId) {
  console.log('Usage: node scripts/audit-podcast-transcripts.js --podcast-id=23 [--json]');
  process.exit(1);
}

const db = getDb();

try {
  const podcast = db
    .prepare('SELECT id, name, host, language FROM podcasts WHERE id=?')
    .get(podcastId);

  if (!podcast) {
    console.error(`Podcast ${podcastId} not found`);
    process.exit(1);
  }

  const episodes = db
    .prepare('SELECT id, title, published_date FROM episodes WHERE podcast_id=? ORDER BY published_date DESC, id DESC')
    .all(podcastId);

  const transcripts = db
    .prepare(
      `SELECT t.id, t.episode_id, t.source, t.language, t.updated_at, t.content
       FROM transcripts t
       JOIN episodes e ON e.id=t.episode_id
       WHERE e.podcast_id=?
       ORDER BY t.episode_id DESC, t.source, t.updated_at DESC, t.id DESC`
    )
    .all(podcastId);

  const byEpisode = new Map();
  for (const transcript of transcripts) {
    if (!byEpisode.has(transcript.episode_id)) byEpisode.set(transcript.episode_id, []);
    byEpisode.get(transcript.episode_id).push(transcript);
  }

  const audits = episodes
    .map(episode => auditEpisode({ episode, transcripts: byEpisode.get(episode.id) || [], podcast }))
    .sort((a, b) => prioritizeEpisode(a) - prioritizeEpisode(b) || b.episodeId - a.episodeId);

  const summary = {
    podcastId: podcast.id,
    podcastName: podcast.name,
    host: podcast.host,
    language: podcast.language,
    episodeCount: audits.length,
    episodesWithIssues: audits.filter(item => item.issues.length > 0).length,
    duplicateTranslateEpisodes: audits.filter(item => item.issues.some(issue => issue.startsWith('Duplicate llm_translate'))).length,
    sourceRecoveryEpisodes: audits.filter(item => item.issues.some(issue => issue.includes('recover English source'))).length,
    manualSpeakerReviewEpisodes: audits.filter(item => item.issues.some(issue => issue.includes('diarization/manual review'))).length,
  };

  if (json) {
    console.log(JSON.stringify({ summary, audits }, null, 2));
  } else {
    console.log(`Podcast ${summary.podcastId}: ${summary.podcastName}`);
    console.log(`Host: ${summary.host || 'N/A'} | Language: ${summary.language || 'N/A'}`);
    console.log(
      `Episodes: ${summary.episodeCount} | With issues: ${summary.episodesWithIssues} | Duplicate translations: ${summary.duplicateTranslateEpisodes} | Source recovery: ${summary.sourceRecoveryEpisodes} | Manual speaker review: ${summary.manualSpeakerReviewEpisodes}`
    );
    console.log('');

    for (const audit of audits) {
      if (audit.issues.length === 0) continue;
      console.log(`ep${audit.episodeId} | ${audit.title}`);
      for (const issue of audit.issues) {
        console.log(`  - ${issue}`);
      }
      const topSpeakers = Object.entries(audit.stats.llmPolishSpeakerCounts)
        .slice(0, 5)
        .map(([speaker, count]) => `${speaker}:${count}`)
        .join(', ');
      if (topSpeakers) console.log(`  - top speakers: ${topSpeakers}`);
      console.log('');
    }
  }
} finally {
  closeDb();
}
