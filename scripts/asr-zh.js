#!/usr/bin/env node
/**
 * ASR pipeline for Chinese podcast episodes without transcripts.
 * Uses faster-whisper (local GPU) for speech-to-text, then LLM polish.
 *
 * Flow: download audio → faster-whisper → save raw → LLM polish → save polished
 */
require('dotenv').config();
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDb, closeDb } = require('../server/src/db');

const API_KEY = 'sk-3ODOY96LmDCFgcBY1d1b586c01E448BcAbB5115bD8FbD2Fc';
const API_URL = 'http://38.246.250.87:3000/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
const WHISPER_MODEL = 'large-v3';
const CHUNK_SIZE = 3000;
const MAX_AUDIO_DURATION = 18000; // 5 hours max

function downloadAudio(url, outPath) {
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    const r = spawnSync('yt-dlp', [
      '-x', '--audio-format', 'mp3', '--audio-quality', '5',
      '--max-filesize', '500m',
      '-o', outPath,
      '--no-playlist', '--quiet',
      url
    ], { timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
    // yt-dlp may add extension
    const base = outPath.replace(/\.[^.]+$/, '');
    for (const ext of ['.mp3', '.m4a', '.opus', '.webm', '.wav']) {
      if (fs.existsSync(base + ext)) return base + ext;
    }
    if (fs.existsSync(outPath)) return outPath;
    return null;
  }
  // Direct audio URL
  try {
    execSync(`curl -L -s -o "${outPath}" --max-time 300 "${url}"`, { timeout: 310000 });
    return fs.existsSync(outPath) && fs.statSync(outPath).size > 1000 ? outPath : null;
  } catch (e) { return null; }
}

function runWhisper(audioPath, language = 'zh') {
  // Use faster-whisper via Python
  const script = `
import sys, json
from faster_whisper import WhisperModel
model = WhisperModel("${WHISPER_MODEL}", device="cuda", compute_type="float16")
segments, info = model.transcribe("${audioPath}", language="${language}", beam_size=5, vad_filter=True, vad_parameters=dict(min_silence_duration_ms=500))
result = []
for seg in segments:
    result.append({"start": seg.start, "end": seg.end, "text": seg.text.strip()})
    if len(result) % 50 == 0:
        sys.stderr.write(f"\\r  ASR: {len(result)} segments, {seg.end:.0f}s...")
sys.stderr.write(f"\\r  ASR: {len(result)} segments, done\\n")
print(json.dumps(result, ensure_ascii=False))
`;
  const r = spawnSync('python3', ['-c', script], {
    timeout: MAX_AUDIO_DURATION * 1000,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024,
  });
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) throw new Error('Whisper failed: ' + (r.stderr || '').slice(-200));
  return JSON.parse(r.stdout);
}

function segmentsToTimestamped(segments) {
  // Group into ~60s paragraphs
  const groups = [];
  let winStart = segments[0]?.start || 0;
  let winTexts = [];
  for (const seg of segments) {
    if (seg.start - winStart >= 60 && winTexts.length > 0) {
      const mm = Math.floor(winStart / 60);
      const ss = Math.floor(winStart % 60);
      groups.push(`[${mm}:${String(ss).padStart(2, '0')}] ${winTexts.join('')}`);
      winStart = seg.start;
      winTexts = [];
    }
    winTexts.push(seg.text);
  }
  if (winTexts.length > 0) {
    const mm = Math.floor(winStart / 60);
    const ss = Math.floor(winStart % 60);
    groups.push(`[${mm}:${String(ss).padStart(2, '0')}] ${winTexts.join('')}`);
  }
  return groups.join('\n');
}

async function callLLM(sys, text) {
  for (let i = 0; i < 3; i++) {
    try {
      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: sys }, { role: 'user', content: text }], max_tokens: 4096 })
      });
      if (resp.status === 429) { await new Promise(r => setTimeout(r, 5000 * (i + 1))); continue; }
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const d = await resp.json();
      return d?.choices?.[0]?.message?.content || text;
    } catch (e) { if (i === 2) throw e; await new Promise(r => setTimeout(r, 3000)); }
  }
}

async function polishTranscript(rawText, podcastName) {
  const sys = `你是播客文字稿编辑器。优化原始语音转录为可读文字稿。
要求：1.添加标点 2.识别说话人用**[真名]**标记（播客:${podcastName}，根据上下文推断名字） 3.换人另起一行 4.保留[MM:SS]时间戳 5.不改原意 6.修正语音识别错误
只输出文稿。`;

  const lines = rawText.split('\n');
  const chunks = [];
  let cur = '';
  for (const l of lines) {
    if (cur.length + l.length > CHUNK_SIZE && cur.length > 0) { chunks.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + l;
  }
  if (cur) chunks.push(cur);

  const results = [];
  let ctx = '';
  for (let i = 0; i < chunks.length; i++) {
    const hint = i > 0 && ctx ? `\n\n(Part ${i + 1}/${chunks.length}. Speakers: ${ctx})` : '';
    const polished = await callLLM(sys, chunks[i] + hint);
    results.push(polished);
    const names = new Set();
    let m;
    const re = /\*\*\[([^\]]+)\]\*\*/g;
    while ((m = re.exec(polished)) !== null) names.add(m[1]);
    if (names.size > 0) ctx = [...names].join(', ');
  }

  let content = results.join('\n\n');
  // Normalize format
  content = content.replace(/\*\*([^*\[\]]{1,20})\*\*[：:]\s*/g, '**[$1]** ');
  content = content.replace(/\*\*([^*\[\]]{1,20})\*\*(\s)/g, (m, n, s) => '**[' + n.trim() + ']**' + s);
  content = content.replace(/\*\*\[([^\]]+)\]\s*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\*\*/g, '**[$1]** [$2]');
  content = content.replace(/^\*\*\[[^\]]+\]\*\*\s*$/gm, '').replace(/\n{3,}/g, '\n\n');
  // Replace generic labels
  const tc = {};
  const tre = /\*\*\[([^\]]+)\]\*\*/g;
  let tm;
  while ((tm = tre.exec(content)) !== null) tc[tm[1]] = (tc[tm[1]] || 0) + 1;
  const generic = ['嘉宾', 'Guest', '对话者', '受访者', '访谈者'];
  const real = Object.entries(tc).filter(([n]) => !generic.includes(n) && !['主持人', 'Host'].includes(n)).sort((a, b) => b[1] - a[1]);
  if (real.length >= 1) {
    for (const g of generic) {
      if (tc[g]) content = content.replace(new RegExp('\\*\\*\\[' + g + '\\]\\*\\*', 'g'), '**[' + real[0][0] + ']**');
    }
  }
  return { content, chunks: chunks.length };
}

async function main() {
  const db = getDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asr-zh-'));

  const episodes = db.prepare(`
    SELECT e.id, e.title, e.episode_url, e.audio_url, p.name as podcast_name
    FROM episodes e
    JOIN podcasts p ON p.id=e.podcast_id
    WHERE p.language LIKE 'zh%'
    AND e.id NOT IN (SELECT episode_id FROM transcripts)
    AND (e.episode_url LIKE '%youtube.com%' OR e.audio_url IS NOT NULL)
    ORDER BY p.name, e.id
  `).all();

  console.log(`\n🎤 ASR Pipeline: ${episodes.length} Chinese episodes\n`);
  const start = Date.now();
  let done = 0, failed = 0;

  for (let idx = 0; idx < episodes.length; idx++) {
    const ep = episodes[idx];
    const elapsed = ((Date.now() - start) / 60000).toFixed(1);
    console.log(`[${idx + 1}/${episodes.length}] (${elapsed}m) ${ep.podcast_name.slice(0, 12)} | ${ep.title.slice(0, 50)}`);

    const audioUrl = ep.episode_url && ep.episode_url.includes('youtube') ? ep.episode_url : ep.audio_url;
    if (!audioUrl) { console.log('  SKIP: no audio source'); failed++; continue; }

    const audioPath = path.join(tmpDir, `ep${ep.id}.mp3`);
    try {
      // 1. Download audio
      process.stdout.write('  Downloading... ');
      const downloaded = downloadAudio(audioUrl, audioPath);
      if (!downloaded) { console.log('FAILED'); failed++; continue; }
      const size = (fs.statSync(downloaded).size / 1024 / 1024).toFixed(1);
      console.log(`OK (${size}MB)`);

      // 2. Run Whisper ASR
      process.stdout.write('  Running Whisper... ');
      const segments = runWhisper(downloaded, 'zh');
      console.log(`${segments.length} segments`);

      // 3. Convert to timestamped text
      const rawText = segmentsToTimestamped(segments);

      // Save raw transcript
      db.prepare("INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'zh', 'asr')").run(ep.id, rawText);

      // 4. Polish with LLM
      process.stdout.write('  Polishing... ');
      const { content: polished, chunks } = await polishTranscript(rawText, ep.podcast_name);
      db.prepare("INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'zh', 'llm_polish')").run(ep.id, polished);
      console.log(`OK (${chunks}ch, ${(polished.length / 1000).toFixed(0)}k)`);

      done++;
    } catch (e) {
      console.log(`  ERROR: ${e.message.slice(0, 100)}`);
      failed++;
    } finally {
      // Cleanup audio file
      try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch (e) {}
      const base = audioPath.replace(/\.[^.]+$/, '');
      for (const ext of ['.mp3', '.m4a', '.opus', '.webm', '.wav']) {
        try { if (fs.existsSync(base + ext)) fs.unlinkSync(base + ext); } catch (e) {}
      }
    }
  }

  try { fs.rmSync(tmpDir, { recursive: true }); } catch (e) {}
  console.log(`\n✅ ${((Date.now() - start) / 60000).toFixed(1)}m: ${done} done, ${failed} failed`);
  closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
