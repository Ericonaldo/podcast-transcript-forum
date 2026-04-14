#!/usr/bin/env node
require('dotenv').config();

const { getDb, closeDb } = require('../server/src/db');
const { fixInlineSpeakerTags } = require('./lib/transcript-inline-speaker');

const args = process.argv.slice(2);
const podcastId = parseInt(args.find((arg) => arg.startsWith('--podcast-id='))?.split('=')[1] || '0', 10);

function titleSpeakerHint(podcastName, title) {
  if (!title) return '';
  if (podcastName === 'TED') {
    const parts = title.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 2];
  }
  return '';
}

function normalizeText(podcastName, title, content) {
  let text = content || '';
  const titleSpeaker = titleSpeakerHint(podcastName, title);
  const output = [];
  let currentSpeaker = titleSpeaker || '';

  for (const rawLine of text.split('\n')) {
    let line = rawLine.trim();
    if (!line) {
      output.push('');
      continue;
    }

    let match = line.match(/^\*\*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\s+\(([^)\n]{1,40})\)\s+([^:\]\n]{1,80}?):\*\*\s*(.*)$/);
    if (match) {
      currentSpeaker = match[3].trim();
      output.push(`[${match[1]}]`);
      output.push(`**[${currentSpeaker}]** ${match[4].trim()}`.trim());
      continue;
    }

    match = line.match(/^\*\*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\s+([^:\]\n]{1,80}?):\*\*\s*(.*)$/);
    if (match) {
      currentSpeaker = match[2].trim();
      output.push(`[${match[1]}]`);
      output.push(`**[${currentSpeaker}]** ${match[3].trim()}`.trim());
      continue;
    }

    match = line.match(/^\*\*\[([^\]\n:]{1,80}):\*\*\s*(.*)$/);
    if (match) {
      currentSpeaker = match[1].trim();
      output.push(`**[${currentSpeaker}]** ${match[2].trim()}`.trim());
      continue;
    }

    match = line.match(/^\*\*\[([^\]]+)\]:\*\*\s*(.*)$/);
    if (match) {
      currentSpeaker = match[1].trim();
      output.push(`**[${currentSpeaker}]** ${match[2].trim()}`.trim());
      continue;
    }

    match = line.match(/^\*\*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\*\*\s*(.*)$/);
    if (match) {
      output.push(`[${match[1]}]`);
      if (match[2].trim()) {
        const speaker = currentSpeaker || titleSpeaker;
        output.push(speaker ? `**[${speaker}]** ${match[2].trim()}` : match[2].trim());
      }
      continue;
    }

    match = line.match(/^\*\*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\s*(.+?)\*\*$/);
    if (match) {
      output.push(`[${match[1]}] ${match[2].trim()}`.trim());
      continue;
    }

    match = line.match(/^\*\*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\s*(.+)$/);
    if (match) {
      output.push(`[${match[1]}] ${match[2].replace(/\*\*$/g, '').trim()}`.trim());
      continue;
    }

    if (line === '**[' || /^\*\*\[\s*$/.test(line)) {
      continue;
    }

    match = line.match(/^\*\*\[([^\]]+)\]\*\*\s*(.*)$/);
    if (match) {
      currentSpeaker = match[1].trim().replace(/^(Video|Narrator|Host)\s+/i, '');
      output.push(`**[${currentSpeaker}]** ${match[2].trim()}`.trim());
      continue;
    }

    line = line.replace(/\*\*\[([^\]]+?)\:\]\*\*/g, '**[$1]**');
    line = line.replace(/\*\*\[([^\]]+)\]\*\*[：:]\s*/g, '**[$1]** ');
    output.push(line);
  }

  text = output.join('\n');
  text = fixInlineSpeakerTags(text);
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

const db = getDb();
const where = podcastId ? 'AND e.podcast_id=?' : '';
const rows = db.prepare(`
  SELECT t.id, e.title, p.name AS podcast_name, t.content
  FROM transcripts t
  JOIN episodes e ON e.id=t.episode_id
  JOIN podcasts p ON p.id=e.podcast_id
  WHERE p.language='en' AND t.source='llm_polish' ${where}
`).all(...(podcastId ? [podcastId] : []));

let fixed = 0;
for (const row of rows) {
  const normalized = normalizeText(row.podcast_name, row.title, row.content);
  if (normalized !== row.content) {
    db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(normalized, row.id);
    fixed += 1;
  }
}

console.log(`Fixed english llm_polish transcripts: ${fixed}`);
closeDb();
