#!/usr/bin/env node
require('dotenv').config();

const { getDb, closeDb } = require('../server/src/db');

const API_KEY = process.env.LLM_API_KEY;
const API_URL = process.env.LLM_API_URL || 'http://38.246.250.87:3000/v1/chat/completions';
const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const CHUNK_SIZE = 3000;
const MAX_LEN = 220000;

const args = process.argv.slice(2);
const podcastId = parseInt(args.find((arg) => arg.startsWith('--podcast-id='))?.split('=')[1] || '0', 10);
const limit = parseInt(args.find((arg) => arg.startsWith('--limit='))?.split('=')[1] || '0', 10);

function makePrompt(episode) {
  return `You are repairing an English podcast transcript from raw ASR.

Podcast: ${episode.podcast_name}
Host hint: ${episode.host || ''}
Episode title: ${episode.title}
Episode description: ${(episode.description || '').slice(0, 1200)}
Known guests: ${episode.guests || ''}

Rules:
1. Output polished English transcript only.
2. Preserve meaning and order.
3. Keep timestamps in [MM:SS] format at paragraph starts.
4. Add speaker labels in strict **[Name]** format.
5. Use the most specific real names supported by the title, description, guest field, and transcript context.
6. Avoid generic labels like Host, Guest, Speaker, Unknown unless there is genuinely no supported better label.
7. Start a new paragraph when the speaker changes.
8. Never output **[Name:]** or timestamp-inside-tag formats.
9. Do not summarize or omit content.`;
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

async function callLLM(system, text) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
      max_tokens: 4096,
      temperature: 0.1,
    }),
  });

  if (!response.ok) throw new Error(`LLM ${response.status}`);
  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

function normalizeContent(content) {
  let text = content || '';
  text = text.replace(/\*\*\[([^\]]+)\]\*\*[：:]\s*/g, '**[$1]** ');
  text = text.replace(/\*\*([^*\n]{1,80}?)[：:]\*\*/g, '**[$1]**');
  text = text.replace(/^\*\*\[$/gm, '');
  text = text.replace(/\*\*\[\s*\n+/g, '**[');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

async function polishEpisode(db, episode) {
  const system = makePrompt(episode);
  const chunks = splitChunks(episode.content.slice(0, MAX_LEN));
  const results = [];
  let speakerContext = '';

  for (let index = 0; index < chunks.length; index += 1) {
    const hint = index > 0 && speakerContext
      ? `\n\n(Part ${index + 1}/${chunks.length}. Use these exact speaker names when they recur: ${speakerContext})`
      : '';
    const polished = await callLLM(system, chunks[index] + hint);
    results.push(polished);

    const names = new Set();
    for (const match of polished.matchAll(/\*\*\[([^\]]+)\]\*\*/g)) {
      names.add(match[1]);
    }
    if (names.size) speakerContext = [...names].join(', ');
  }

  const content = normalizeContent(results.join('\n\n'));
  db.prepare("INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'en', 'llm_polish')")
    .run(episode.id, content);
  return `OK (${chunks.length} chunks, ${(content.length / 1000).toFixed(0)}k)`;
}

async function main() {
  const db = getDb();
  let episodes = db.prepare(`
    SELECT e.id, e.title, e.description, e.guests, p.name AS podcast_name, p.host, t.content
    FROM episodes e
    JOIN podcasts p ON p.id=e.podcast_id
    JOIN transcripts t ON t.episode_id=e.id AND t.source='asr'
    WHERE p.language='en'
      ${podcastId ? 'AND p.id=?' : ''}
      AND NOT EXISTS (SELECT 1 FROM transcripts tx WHERE tx.episode_id=e.id AND tx.source='llm_polish')
    ORDER BY e.id DESC
  `).all(...(podcastId ? [podcastId] : []));

  if (limit > 0) episodes = episodes.slice(0, limit);
  console.log(`Polish english asr-only: ${episodes.length} episodes`);

  let ok = 0;
  let failed = 0;
  for (const episode of episodes) {
    process.stdout.write(`ep${episode.id} ${episode.title.slice(0, 70)} ... `);
    try {
      const result = await polishEpisode(db, episode);
      console.log(result);
      ok += 1;
    } catch (error) {
      console.log(`FAIL (${error.message})`);
      failed += 1;
    }
  }

  console.log(`Done: ${ok} ok, ${failed} failed`);
  closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
