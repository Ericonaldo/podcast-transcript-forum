#!/usr/bin/env node
require('dotenv').config();

const { getDb, closeDb } = require('../server/src/db');

const args = process.argv.slice(2);
const podcastId = parseInt(args.find((arg) => arg.startsWith('--podcast-id='))?.split('=')[1] || '0', 10);

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

function splitNames(value) {
  return uniq(String(value || '')
    .split(/,|&| and /i)
    .map((part) => part.trim())
    .filter(Boolean));
}

function looksLikePerson(name) {
  if (!name) return false;
  if (/(Various|NPR|TED|Y Combinator|Andreessen Horowitz)/i.test(name)) return false;
  return /[A-Z][a-z]+(?:\s+[A-Z][A-Za-z.'-]+)+/.test(name) || /^Dr\.\s+[A-Z]/.test(name);
}

function titleHints(podcastName, title) {
  const hints = [];
  if (!title) return hints;

  if (podcastName === 'TED') {
    const parts = title.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) hints.push(parts[parts.length - 2]);
  }

  const pipeParts = title.split('|').map((part) => part.trim()).filter(Boolean);
  const lastPipe = pipeParts[pipeParts.length - 1];
  if (looksLikePerson(lastPipe)) hints.push(lastPipe);

  const patterns = [
    /^#?\d+\s*[–-]\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})(?::|—|–|-)/,
    /^[^:]{0,120}:\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})\./,
    /\|\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})\s+Interview/i,
    /\|\s*(Dr\.\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})/i,
    /with\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})/i,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match?.[1]) hints.push(match[1].trim());
  }

  return uniq(hints);
}

function descriptionHints(description) {
  const text = String(description || '').slice(0, 1200);
  const hints = [];
  const patterns = [
    /My guest today is ([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})/g,
    /joins the show(?: again)? to discuss .*?([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})/g,
    /(?:with|featuring|interview with)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      hints.push(match[1].trim());
    }
  }
  return uniq(hints);
}

function canonicalMap(name, candidates) {
  if (!name) return '';
  const trimmed = name.trim();
  for (const candidate of candidates) {
    if (trimmed === candidate) return candidate;
    const candidateParts = candidate.replace(/^Dr\.\s+/i, '').split(/\s+/);
    const nameParts = trimmed.replace(/^Dr\.\s+/i, '').split(/\s+/);
    if (nameParts.length === 1 && candidateParts.some((part) => part === nameParts[0])) {
      return candidate;
    }
    if (nameParts.length >= 1 && candidateParts.length >= 1 && nameParts[nameParts.length - 1] === candidateParts[candidateParts.length - 1]) {
      return candidate;
    }
  }
  return trimmed;
}

function normalizeEpisode(content, host, guestHints, podcastName) {
  let text = content || '';
  const hostLabel = host || podcastName;
  const guestLabel = guestHints[0] || '';
  const tags = uniq([...text.matchAll(/\*\*\[([^\]]+)\]\*\*/g)].map((match) => match[1]));
  const candidatePeople = uniq([
    ...(looksLikePerson(hostLabel) ? [hostLabel] : []),
    ...guestHints,
  ]);

  for (const tag of tags) {
    let replacement = tag;
    if (/^Host:?$/i.test(tag)) replacement = hostLabel;
    else if (/^(Guest|UNKNOWN|Unknown|Speaker|Speaker_00|Speaker_01|SPEAKER_00|SPEAKER_01):?$/i.test(tag) && guestLabel) replacement = guestLabel;
    else if (tag === 'Narrator:' || tag === 'Host:') replacement = hostLabel;
    else replacement = canonicalMap(tag.replace(/:$/, ''), candidatePeople);

    if (replacement && replacement !== tag) {
      const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`\\*\\*\\[${escaped}\\]\\*\\*`, 'g'), `**[${replacement}]**`);
    }
  }

  return text.replace(/\*\*\[([^\]]+)\]\*\*[：:]\s*/g, '**[$1]** ');
}

const db = getDb();
const where = podcastId ? 'AND p.id=?' : '';
const rows = db.prepare(`
  SELECT t.id, t.content, e.title, e.description, e.guests, p.id AS podcast_id, p.name AS podcast_name, p.host
  FROM transcripts t
  JOIN episodes e ON e.id=t.episode_id
  JOIN podcasts p ON p.id=e.podcast_id
  WHERE p.language='en' AND t.source='llm_polish' ${where}
`).all(...(podcastId ? [podcastId] : []));

let fixed = 0;
for (const row of rows) {
  const guestHints = uniq([
    ...splitNames(row.guests),
    ...titleHints(row.podcast_name, row.title),
    ...descriptionHints(row.description),
  ]);
  const normalized = normalizeEpisode(row.content, row.host, guestHints, row.podcast_name);
  if (normalized !== row.content) {
    db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(normalized, row.id);
    fixed += 1;
  }
}

console.log(`Normalized english speaker labels: ${fixed}`);
closeDb();
