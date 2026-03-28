#!/usr/bin/env node
/**
 * Quick fix for episodes with ASR speaker labels but broken polish.
 * Uses LLM to identify speaker names, then formats with simple regex.
 */
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');

const API_KEY = process.env.LLM_API_KEY;
const API_URL = process.env.LLM_API_URL;
const EPISODE_IDS = process.argv.slice(2).map(Number).filter(Boolean);

if (!EPISODE_IDS.length) {
  console.log('Usage: node /tmp/quick-fix.js <episode_id> ...');
  process.exit(1);
}

async function callLLM(messages) {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-chat', messages, max_tokens: 1000, temperature: 0 })
  });
  if (!r.ok) throw new Error(`API ${r.status}`);
  const d = await r.json();
  return d?.choices?.[0]?.message?.content || '';
}

async function quickFix(db, epId) {
  const ep = db.prepare(`
    SELECT e.id, e.title, e.description, e.guests, p.host, p.name as podcast_name
    FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE e.id=?
  `).get(epId);
  if (!ep) { console.log(`Episode ${epId} not found`); return; }

  const asr = db.prepare(`
    SELECT content FROM transcripts WHERE episode_id=? AND source='asr' ORDER BY created_at DESC LIMIT 1
  `).get(epId);
  if (!asr) { console.log(`No ASR for episode ${epId}`); return; }

  console.log(`\nEp${epId}: ${ep.title.slice(0, 60)}`);
  console.log(`  ASR: ${(asr.content.length/1000).toFixed(0)}k chars`);

  // Extract unique speakers
  const speakers = new Set();
  for (const m of asr.content.matchAll(/\[SPEAKER_(\d+)\]/g)) {
    speakers.add(m[1]);
  }
  console.log(`  Speakers found: ${[...speakers].map(s => 'SPEAKER_' + s).join(', ')}`);

  // Use LLM to identify speakers from first portion
  const sample = asr.content.slice(0, 3000);
  const namePrompt = `这是播客"${ep.podcast_name}"的转录片段。主持人是${ep.host || '未知'}。

${sample}

请识别每个SPEAKER_XX对应的真实姓名。
${ep.description ? '节目简介：' + ep.description.slice(0, 300) : ''}

只输出JSON格式，如: {"SPEAKER_00": "张三", "SPEAKER_01": "李四"}`;

  let speakerMap = {};
  try {
    const resp = await callLLM([{role: 'user', content: namePrompt}]);
    const jsonMatch = resp.match(/\{[^}]+\}/);
    if (jsonMatch) speakerMap = JSON.parse(jsonMatch[0]);
  } catch(e) {
    console.log(`  LLM error: ${e.message}`);
  }
  console.log(`  Speaker map: ${JSON.stringify(speakerMap)}`);

  // If LLM didn't work, use host name for most common speaker
  if (Object.keys(speakerMap).length === 0) {
    const counts = {};
    for (const m of asr.content.matchAll(/\[SPEAKER_(\d+)\]/g)) {
      counts[m[1]] = (counts[m[1]] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]);
    if (sorted.length >= 1) speakerMap['SPEAKER_' + sorted[0][0]] = ep.host || '主持人';
    if (sorted.length >= 2) speakerMap['SPEAKER_' + sorted[1][0]] = '嘉宾';
  }

  // Now format the transcript
  let content = asr.content;
  
  // Replace SPEAKER_XX with real names
  for (const [spk, name] of Object.entries(speakerMap)) {
    content = content.replace(new RegExp('\\[' + spk + '\\]', 'g'), `**[${name}]**`);
  }
  // Clean up any remaining SPEAKER_XX
  content = content.replace(/\[SPEAKER_\d+\]/g, '**[嘉宾]**');

  // Format: merge same-speaker lines, add punctuation via simple rules
  const lines = content.split('\n').filter(l => l.trim());
  const paragraphs = [];
  let curSpeaker = null, curText = '';

  for (const line of lines) {
    const spMatch = line.match(/\*\*\[([^\]]+)\]\*\*/);
    const speaker = spMatch ? spMatch[1] : null;
    let text = line.replace(/\*\*\[[^\]]+\]\*\*\s*/, '').replace(/^\[\d+:\d+\]\s*/, '').trim();
    if (!text) continue;

    if (speaker === curSpeaker && curText.length + text.length < 3000) {
      curText += text;
    } else {
      if (curSpeaker && curText.trim()) {
        paragraphs.push(`**[${curSpeaker}]** ${curText.trim()}`);
      }
      curSpeaker = speaker || curSpeaker;
      curText = text;
    }
  }
  if (curSpeaker && curText.trim()) {
    paragraphs.push(`**[${curSpeaker}]** ${curText.trim()}`);
  }

  const result = paragraphs.join('\n\n');
  console.log(`  Result: ${(result.length/1000).toFixed(0)}k chars, ${paragraphs.length} paragraphs`);

  // Save
  const existing = db.prepare("SELECT id FROM transcripts WHERE episode_id=? AND source='llm_polish'").get(epId);
  if (existing) {
    db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(result, existing.id);
    console.log(`  SAVED (updated id=${existing.id})`);
  } else {
    db.prepare("INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'zh', 'llm_polish')").run(epId, result);
    console.log(`  SAVED (new)`);
  }
}

async function main() {
  const db = getDb();
  for (const id of EPISODE_IDS) {
    await quickFix(db, id);
  }
  closeDb();
}
main().catch(e => { console.error(e); process.exit(1); });
