#!/usr/bin/env node
require('dotenv').config();

const { spawnSync } = require('child_process');
const { getDb, closeDb } = require('../server/src/db');
const { fixInlineSpeakerTags } = require('./lib/transcript-inline-speaker');

const API_KEY = process.env.LLM_API_KEY;
const API_URL = process.env.LLM_API_URL || 'http://38.246.250.87:3000/v1/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const HOST_NAME = "Patrick O'Shaughnessy";

const args = process.argv.slice(2);
const podcastId = parseInt(args.find((a) => a.startsWith('--podcast-id='))?.split('=')[1] || '32', 10);
const episodeFilter = new Set((args.find((a) => a.startsWith('--episodes='))?.split('=')[1] || '')
  .split(',')
  .map((s) => parseInt(s, 10))
  .filter(Boolean));

function normalizeJson(text) {
  return text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function sanitizeSpeakerName(name) {
  if (!name) return '';

  let cleaned = String(name)
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .replace(/\*\*/g, '')
    .replace(/^\s*\[+/, '')
    .replace(/\]+\s*$/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  cleaned = cleaned
    .replace(/^Name\s*/i, '')
    .replace(/^Speaker\s*Name\s*/i, 'Guest ')
    .replace(/^Host$/i, HOST_NAME)
    .replace(/^Patrick$/i, HOST_NAME)
    .replace(/^Unknown$/i, 'Guest')
    .replace(/^UNKNOWN$/i, 'Guest');

  cleaned = cleaned.replace(/^(Speaker|SPEAKER)[ _-]?\d+$/i, 'Guest');
  cleaned = cleaned.replace(/[.:：]+$/g, '').trim();

  if (cleaned.includes(' or ')) {
    cleaned = cleaned.replace(/\s+or\s+/gi, ' & ');
  }

  return cleaned;
}

async function callLLM(messages) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      max_tokens: 800,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM ${response.status}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

function fetchYouTubeMeta(url) {
  if (!url || !url.includes('youtube.com')) return null;

  const result = spawnSync(
    'yt-dlp',
    ['--print', 'title', '--print', 'description', '--no-playlist', '--quiet', url],
    { encoding: 'utf8', timeout: 180000 }
  );

  if (result.status !== 0) return null;
  const [title, ...descLines] = (result.stdout || '').split('\n');
  return {
    title: title?.trim() || '',
    description: descLines.join('\n').trim(),
  };
}

function parseAsrLines(content) {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\[(\d{1,3}:\d{2}(?::\d{2})?)\]\s+\[(SPEAKER_\d+|UNKNOWN)\]\s*(.*)$/);
      if (!match) return null;
      return {
        timestamp: `[${match[1]}]`,
        speaker: match[2],
        text: match[3].trim(),
      };
    })
    .filter(Boolean);
}

function buildNamedTranscript(lines, speakerMap) {
  const groups = [];
  let current = null;

  for (const line of lines) {
    const mappedSpeaker = speakerMap[line.speaker] || line.speaker;
    if (!current || current.speaker !== mappedSpeaker) {
      if (current) groups.push(current);
      current = {
        timestamp: line.timestamp,
        speaker: mappedSpeaker,
        parts: [],
      };
    }
    if (line.text) current.parts.push(line.text);
  }

  if (current) groups.push(current);

  const content = groups
    .map((group) => `${group.timestamp} **[${group.speaker}]** ${group.parts.join(' ').replace(/\s+/g, ' ').trim()}`.trim())
    .join('\n\n');

  return normalizePolish(content, speakerMap);
}

function normalizePolish(content, speakerMap) {
  let normalized = content;

  normalized = normalized.replace(/\*\*\[([^\]]+)\]\*\*[：:]\s*/g, '**[$1]** ');
  normalized = normalized.replace(/\*\*([^*\n]{1,80}?)[：:]\*\*/g, '**[$1]**');
  normalized = normalized.replace(/^\*\*\[$/gm, '');
  normalized = normalized.replace(/\*\*\[\s*\n+/g, '**[');
  normalized = normalized.replace(/\n{3,}/g, '\n\n').trim();

  for (const [speakerId, name] of Object.entries(speakerMap)) {
    if (!name || !speakerId.startsWith('SPEAKER_')) continue;
    const firstName = name.split(/\s+/)[0];
    if (firstName && firstName !== name) {
      normalized = normalized.replaceAll(`**[${firstName}]**`, `**[${name}]**`);
    }
  }

  normalized = normalized
    .replaceAll('**[Patrick]**', `**[${HOST_NAME}]**`)
    .replaceAll('**[Host]**', `**[${HOST_NAME}]**`)
    .replaceAll('**[Speaker_00]**', `**[${HOST_NAME}]**`)
    .replaceAll('**[SPEAKER_00]**', `**[${HOST_NAME}]**`)
    .replaceAll('**[Speaker_01]**', '**[Guest]**')
    .replaceAll('**[SPEAKER_01]**', '**[Guest]**');

  normalized = fixInlineSpeakerTags(normalized);
  return normalized.replace(/\n{3,}/g, '\n\n').trim();
}

async function inferSpeakerMap(episode, asrLines, remoteMeta) {
  const excerpt = asrLines.slice(0, 14)
    .map((line) => `${line.timestamp} [${line.speaker}] ${line.text}`)
    .join('\n');
  const speakerIds = [...new Set(asrLines.map((line) => line.speaker))];

  const system = `You map diarized speaker IDs in a podcast transcript to real speaker names.

Rules:
1. The podcast host is always ${HOST_NAME}.
2. Use only names clearly supported by the episode title, episode description, YouTube description, or transcript excerpt.
3. Prefer full real names when available.
4. If one speaker ID covers multiple guests in a shared interview, use a combined label like "Name A & Name B".
5. Return strict JSON only in the form {"SPEAKER_00":"Name","SPEAKER_01":"Name"}.
6. Do not invent names that are not supported by the provided text.`;

  const user = `Podcast: Invest Like The Best
Episode title: ${episode.title}
Episode description: ${episode.description || ''}
YouTube description: ${remoteMeta?.description || ''}
Known guests field: ${episode.guests || ''}
Speaker IDs present: ${speakerIds.join(', ')}

Transcript excerpt:
${excerpt}`;

  const raw = await callLLM([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);

  const parsed = JSON.parse(normalizeJson(raw));
  const speakerMap = {};
  for (const speakerId of speakerIds) {
    const mapped = parsed[speakerId];
    if (!mapped || typeof mapped !== 'string') {
      speakerMap[speakerId] = speakerId === 'SPEAKER_00' ? HOST_NAME : 'Guest';
      continue;
    }
    speakerMap[speakerId] = sanitizeSpeakerName(mapped);
  }

  const nonHostNames = [...new Set(Object.values(speakerMap).filter((name) => name && name !== HOST_NAME && name !== 'Guest'))];
  if (nonHostNames.length === 1) {
    for (const [speakerId, mapped] of Object.entries(speakerMap)) {
      if (speakerId === 'UNKNOWN' || mapped === 'Guest') {
        speakerMap[speakerId] = nonHostNames[0];
      }
    }
  }

  return speakerMap;
}

async function repairEpisode(db, episode) {
  const asr = db.prepare("SELECT id, content FROM transcripts WHERE episode_id=? AND source='asr'").get(episode.id);
  if (!asr) return 'SKIP(no asr)';

  const asrLines = parseAsrLines(asr.content);
  if (!asrLines.length) return 'SKIP(empty asr)';

  const remoteMeta = (!episode.description || !episode.description.trim()) ? fetchYouTubeMeta(episode.episode_url) : null;
  if (remoteMeta?.description && (!episode.description || !episode.description.trim())) {
    db.prepare('UPDATE episodes SET description=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(remoteMeta.description.slice(0, 2000), episode.id);
  }
  if (remoteMeta?.title && remoteMeta.title !== episode.title) {
    db.prepare('UPDATE episodes SET title=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(remoteMeta.title, episode.id);
    episode.title = remoteMeta.title;
  }

  const speakerMap = await inferSpeakerMap(episode, asrLines, remoteMeta);
  const content = buildNamedTranscript(asrLines, speakerMap);

  const existing = db.prepare("SELECT id FROM transcripts WHERE episode_id=? AND source='llm_polish'").get(episode.id);
  if (existing) {
    db.prepare('UPDATE transcripts SET content=?, language=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(content, 'en', existing.id);
  } else {
    db.prepare("INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'en', 'llm_polish')")
      .run(episode.id, content);
  }

  return `OK (${Object.entries(speakerMap).map(([k, v]) => `${k}=${v}`).join(', ')})`;
}

async function main() {
  const db = getDb();
  const episodes = db.prepare(`
    SELECT e.id, e.title, e.description, e.guests, e.episode_url
    FROM episodes e
    WHERE e.podcast_id=?
      AND e.id IN (SELECT episode_id FROM transcripts WHERE source='asr')
    ORDER BY e.id
  `).all(podcastId).filter((episode) => episodeFilter.size === 0 || episodeFilter.has(episode.id));

  console.log(`Repair podcast ${podcastId}: ${episodes.length} episodes`);

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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
