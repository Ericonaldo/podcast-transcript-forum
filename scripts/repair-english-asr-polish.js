#!/usr/bin/env node
require('dotenv').config();

const { getDb, closeDb } = require('../server/src/db');
const { fixInlineSpeakerTags } = require('./lib/transcript-inline-speaker');

const API_KEY = process.env.LLM_API_KEY;
const API_URL = process.env.LLM_API_URL || 'http://38.246.250.87:3000/v1/chat/completions';
const MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const CHUNK_SIZE = 3000;

const args = process.argv.slice(2);
const podcastId = parseInt(args.find((arg) => arg.startsWith('--podcast-id='))?.split('=')[1] || '0', 10);
const onlyBad = args.includes('--only-bad');
const episodeFilter = new Set((args.find((arg) => arg.startsWith('--episodes='))?.split('=')[1] || '')
  .split(',')
  .map((value) => parseInt(value, 10))
  .filter(Boolean));

if (!podcastId) {
  console.error('Usage: node scripts/repair-english-asr-polish.js --podcast-id=<id> [--only-bad] [--episodes=1,2]');
  process.exit(1);
}

function normalizeJson(text) {
  return text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function polishIssues(content) {
  const text = content || '';
  const malformed = (text.match(/^\*\*\[$/gm) || []).length
    + (text.match(/\*\*\[[^\]]+\]:\*\*/g) || []).length
    + text.split('\n').filter((line) => ((line.match(/\*\*/g) || []).length % 2) === 1).length;
  const tags = [...text.matchAll(/\*\*\[([^\]]+)\]\*\*/g)].map((m) => m[1]);
  const uniq = [...new Set(tags)];
  const generic = uniq.some((name) => /^(Guest|UNKNOWN|Unknown|Speaker|Host)$/i.test(name)
    || /SPEAKER_/i.test(name)
    || /主持人|嘉宾/.test(name));
  return malformed > 0 || generic;
}

async function callLLM(messages) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 4096,
      temperature: 0.1,
    }),
  });
  if (!response.ok) {
    throw new Error(`LLM ${response.status}`);
  }
  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

function splitChunks(text) {
  const lines = text.split('\n');
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if (current.length + line.length > CHUNK_SIZE && current) {
      chunks.push(current);
      current = '';
    }
    current += (current ? '\n' : '') + line;
  }
  if (current) chunks.push(current);
  return chunks;
}

function normalizeContent(content) {
  let text = content || '';
  text = text.replace(/\*\*\[([^\]]+)\]\*\*[：:]\s*/g, '**[$1]** ');
  text = text.replace(/\*\*([^*\n]{1,80}?)[：:]\*\*/g, '**[$1]**');
  text = text.replace(/^\*\*\[$/gm, '');
  text = text.replace(/\*\*\[\s*\n+/g, '**[');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  text = fixInlineSpeakerTags(text);
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

async function repairEpisode(db, episode) {
  const asr = db.prepare("SELECT id, content FROM transcripts WHERE episode_id=? AND source='asr' ORDER BY id DESC LIMIT 1").get(episode.id);
  if (!asr) return 'SKIP(no asr)';

  const system = `You are repairing an English podcast transcript from raw ASR.

Podcast: ${episode.podcast_name}
Host hint: ${episode.host || ''}
Episode title: ${episode.title}
Episode description: ${episode.description || ''}
Known guests: ${episode.guests || ''}

Rules:
1. Output polished English transcript only.
2. Keep the original meaning and ordering of the text.
3. Preserve timestamps at the start of each paragraph.
4. Add speaker labels in strict **[Name]** format.
5. Use the most specific real names supported by the title, description, guest field, and transcript context.
6. Avoid generic labels like Host, Guest, Speaker, UNKNOWN unless there is genuinely no better supported name.
7. Start a new paragraph when the speaker changes.
8. Do not output **[Name:]** or timestamp-inside-tag formats.
9. If this is a solo talk or narrated piece, use the actual speaker's name rather than forcing the podcast host hint.`;

  const chunks = splitChunks(asr.content);
  const results = [];
  let speakerContext = '';

  for (let index = 0; index < chunks.length; index += 1) {
    const hint = index > 0 && speakerContext
      ? `\n\n(Part ${index + 1}/${chunks.length}. Use these exact speaker names when they recur: ${speakerContext})`
      : '';
    const polished = await callLLM([
      { role: 'system', content: system },
      { role: 'user', content: chunks[index] + hint },
    ]);
    results.push(polished);

    const names = new Set();
    for (const match of polished.matchAll(/\*\*\[([^\]]+)\]\*\*/g)) {
      names.add(match[1]);
    }
    if (names.size) speakerContext = [...names].join(', ');
  }

  const content = normalizeContent(results.join('\n\n'));
  const existing = db.prepare("SELECT id FROM transcripts WHERE episode_id=? AND source='llm_polish'").get(episode.id);
  if (existing) {
    db.prepare('UPDATE transcripts SET content=?, language=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(content, 'en', existing.id);
  } else {
    db.prepare("INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'en', 'llm_polish')").run(episode.id, content);
  }
  return `OK (${chunks.length} chunks, ${(content.length / 1000).toFixed(0)}k)`;
}

const db = getDb();
const podcast = db.prepare('SELECT id, name, host FROM podcasts WHERE id=? AND language=\'en\'').get(podcastId);
if (!podcast) {
  console.error(`English podcast ${podcastId} not found`);
  process.exit(1);
}

const episodes = db.prepare(`
  SELECT e.id, e.title, e.description, e.guests, p.name AS podcast_name, p.host,
         (SELECT content FROM transcripts t WHERE t.episode_id=e.id AND t.source='llm_polish' ORDER BY t.id DESC LIMIT 1) AS polish_content,
         EXISTS(SELECT 1 FROM transcripts t WHERE t.episode_id=e.id AND t.source='asr') AS has_asr
  FROM episodes e
  JOIN podcasts p ON p.id=e.podcast_id
  WHERE e.podcast_id=?
  ORDER BY e.id
`).all(podcastId).filter((episode) => {
  if (episodeFilter.size && !episodeFilter.has(episode.id)) return false;
  if (!episode.has_asr) return false;
  if (!onlyBad) return true;
  if (!episode.polish_content) return true;
  return polishIssues(episode.polish_content);
});

console.log(`Repair english podcast ${podcastId} (${podcast.name}): ${episodes.length} episodes`);

(async () => {
  let ok = 0;
  let failed = 0;
  for (const episode of episodes) {
    process.stdout.write(`ep${episode.id} ${episode.title.slice(0, 70)} ... `);
    try {
      const result = await repairEpisode(db, episode);
      console.log(result);
      if (result.startsWith('OK')) ok += 1;
    } catch (error) {
      console.log(`FAIL (${error.message})`);
      failed += 1;
    }
  }
  console.log(`Done: ${ok} ok, ${failed} failed`);
  closeDb();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
