#!/usr/bin/env node
require('dotenv').config();

const Database = require('better-sqlite3');

const db = new Database('data/podcast.db');

function getTitleSpeakerHint(podcastName, title) {
  if (!title) return '';
  if (podcastName === 'TED') {
    const parts = title.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 2];
  }
  const m = title.match(/[-|]\s+([A-Z][A-Za-z.'\-]+(?:\s+[A-Z][A-Za-z.'\-]+){0,3})(?:\s+Interview|\s+\[|\s*$)/);
  return m ? m[1].trim() : '';
}

function analyzePolish(content) {
  const text = content || '';
  const malformed = (text.match(/^\*\*\[$/gm) || []).length
    + (text.match(/\*\*\[[^\]]+\]:\*\*/g) || []).length
    + text.split('\n').filter((line) => ((line.match(/\*\*/g) || []).length % 2) === 1).length;
  const tags = [...text.matchAll(/\*\*\[([^\]]+)\]\*\*/g)].map((m) => m[1]);
  const uniq = [...new Set(tags)];
  const generic = uniq.filter((name) => /^(Guest|UNKNOWN|Unknown|Speaker|Host)$/i.test(name)
    || /SPEAKER_/i.test(name)
    || /主持人|嘉宾/.test(name));
  const inline = text.split('\n').some((line) => {
    const matches = line.match(/\*\*\[[^\]]+\]\*\*/g) || [];
    const trimmed = line.trimStart();
    return matches.length > 1
      || (matches.length > 0
        && !trimmed.startsWith(matches[0])
        && !/^\[\d{1,3}:\d{2}(?::\d{2})?\]\s+\*\*\[[^\]]+\]\*\*/.test(trimmed));
  });

  return {
    malformed,
    generic,
    inline,
    speakerCount: uniq.length,
    speakers: uniq,
  };
}

const podcasts = db.prepare(`
  SELECT id, name, host
  FROM podcasts
  WHERE language='en'
  ORDER BY id
`).all();

const summary = [];

for (const podcast of podcasts) {
  const episodes = db.prepare(`
    SELECT e.id, e.title,
           EXISTS(SELECT 1 FROM transcripts t WHERE t.episode_id=e.id) AS has_any,
           EXISTS(SELECT 1 FROM transcripts t WHERE t.episode_id=e.id AND t.source='asr') AS has_asr,
           EXISTS(SELECT 1 FROM transcripts t WHERE t.episode_id=e.id AND t.source='llm_polish') AS has_polish,
           (SELECT content FROM transcripts t WHERE t.episode_id=e.id AND t.source='llm_polish' ORDER BY t.id DESC LIMIT 1) AS polish_content
    FROM episodes e
    WHERE e.podcast_id=?
    ORDER BY e.id
  `).all(podcast.id);

  const row = {
    id: podcast.id,
    name: podcast.name,
    total: episodes.length,
    missing: 0,
    asrOnly: 0,
    malformed: 0,
    generic: 0,
    inline: 0,
    speakerlessHints: 0,
  };

  for (const episode of episodes) {
    if (!episode.has_any) row.missing += 1;
    if (episode.has_asr && !episode.has_polish) row.asrOnly += 1;
    if (!episode.has_polish || !episode.polish_content) continue;

    const analysis = analyzePolish(episode.polish_content);
    if (analysis.malformed) row.malformed += 1;
    if (analysis.generic.length) row.generic += 1;
    if (analysis.inline) row.inline += 1;

    if (analysis.speakerCount <= 1 && getTitleSpeakerHint(podcast.name, episode.title)) {
      row.speakerlessHints += 1;
    }
  }

  summary.push(row);
}

for (const row of summary.sort((a, b) => (b.missing + b.asrOnly + b.malformed + b.generic) - (a.missing + a.asrOnly + a.malformed + a.generic))) {
  console.log(JSON.stringify(row));
}
