#!/usr/bin/env node
/**
 * Priority ASR for specific podcasts. Runs 3 workers in parallel.
 * Each worker: download audio → faster-whisper → save → LLM polish
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
const LD_PATH = '/home/mhliu/miniconda3/pkgs/libcublas-12.6.4.1-0/lib:' + (process.env.LD_LIBRARY_PATH || '');

// Priority podcast IDs
const PRIORITY_IDS = (process.argv[2] || '16,17,18').split(',').map(Number);

function downloadAudio(url, outPath) {
  const r = spawnSync('yt-dlp', [
    '-x', '--audio-format', 'mp3', '--audio-quality', '5',
    '--max-filesize', '500m', '-o', outPath,
    '--no-playlist', '--quiet', url
  ], { timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = outPath.replace(/\.[^.]+$/, '');
  for (const ext of ['.mp3', '.m4a', '.opus', '.webm', '.wav']) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  return fs.existsSync(outPath) ? outPath : null;
}

function runWhisper(audioPath) {
  const script = `
import sys, json
from faster_whisper import WhisperModel
model = WhisperModel("${WHISPER_MODEL}", device="cuda", compute_type="float16")
segments, info = model.transcribe("${audioPath}", language="zh", beam_size=5, vad_filter=True, vad_parameters=dict(min_silence_duration_ms=500))
result = []
for seg in segments:
    result.append({"start": seg.start, "end": seg.end, "text": seg.text.strip()})
    if len(result) % 100 == 0:
        sys.stderr.write(f"\\r  {len(result)} segs, {seg.end:.0f}s")
sys.stderr.write(f"\\r  {len(result)} segs done\\n")
print(json.dumps(result, ensure_ascii=False))
`;
  const r = spawnSync('python3', ['-c', script], {
    timeout: 7200000, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, LD_LIBRARY_PATH: LD_PATH },
  });
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) throw new Error('Whisper failed');
  return JSON.parse(r.stdout);
}

function segsToText(segments) {
  const groups = [];
  if (!segments.length) return '';
  let ws = segments[0].start, wt = [];
  for (const s of segments) {
    if (s.start - ws >= 60 && wt.length) {
      groups.push(`[${Math.floor(ws/60)}:${String(Math.floor(ws%60)).padStart(2,'0')}] ${wt.join('')}`);
      ws = s.start; wt = [];
    }
    wt.push(s.text);
  }
  if (wt.length) groups.push(`[${Math.floor(ws/60)}:${String(Math.floor(ws%60)).padStart(2,'0')}] ${wt.join('')}`);
  return groups.join('\n');
}

async function callLLM(sys, text) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages: [{role:'system',content:sys},{role:'user',content:text}], max_tokens: 4096 })
      });
      if (r.status === 429) { await new Promise(r => setTimeout(r, 5000*(i+1))); continue; }
      if (!r.ok) throw new Error(`API ${r.status}`);
      const d = await r.json();
      return d?.choices?.[0]?.message?.content || text;
    } catch(e) { if (i===2) throw e; await new Promise(r=>setTimeout(r,3000)); }
  }
}

async function polish(rawText, podcastName) {
  const sys = `你是播客文字稿编辑器。优化原始语音转录为可读文字稿。
要求：1.添加标点 2.识别说话人用**[真名]**标记（播客:${podcastName}） 3.换人另起一行 4.保留[MM:SS]时间戳 5.不改原意 6.修正语音识别错误
只输出文稿。`;
  const lines = rawText.split('\n');
  const chunks = []; let cur = '';
  for (const l of lines) {
    if (cur.length + l.length > CHUNK_SIZE && cur.length > 0) { chunks.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + l;
  }
  if (cur) chunks.push(cur);

  const results = []; let ctx = '';
  for (let i = 0; i < chunks.length; i++) {
    const hint = i > 0 && ctx ? `\n\n(Part ${i+1}/${chunks.length}. Speakers: ${ctx})` : '';
    const p = await callLLM(sys, chunks[i] + hint);
    results.push(p);
    const names = new Set(); let m; const re = /\*\*\[([^\]]+)\]\*\*/g;
    while ((m = re.exec(p)) !== null) names.add(m[1]);
    if (names.size > 0) ctx = [...names].join(', ');
  }

  let content = results.join('\n\n');
  // Normalize tags
  content = content.replace(/\*\*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\s*([^*]{1,30}?)\*\*[：:]*\s*/g, '**[$2]** [$1] ');
  content = content.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*[：:]\s*/g, '$1**[$2]** ');
  content = content.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*(\s)/g, (m, pre, name, sp) => pre + '**[' + name.trim() + ']**' + sp);
  content = content.replace(/\*\*\[([^\]]+)\]\s*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\*\*/g, '**[$1]** [$2]');
  content = content.replace(/^\*\*\[[^\]]+\]\*\*\s*$/gm, '').replace(/\n{3,}/g, '\n\n');
  // Replace generic labels
  const tc = {}; const tre = /\*\*\[([^\]]+)\]\*\*/g; let tm;
  while ((tm = tre.exec(content)) !== null) tc[tm[1]] = (tc[tm[1]]||0)+1;
  const generic = ['嘉宾','Guest','对话者','受访者','访谈者'];
  const real = Object.entries(tc).filter(([n])=>!generic.includes(n)&&!['主持人','Host','张小珺'].includes(n)).sort((a,b)=>b[1]-a[1]);
  if (real.length>=1) for (const g of generic) if(tc[g]) content=content.replace(new RegExp('\\*\\*\\['+g+'\\]\\*\\*','g'),'**['+real[0][0]+']**');
  content = content.replace(/\*\*\[张小珺Jùn\]\*\*/g, '**[张小珺]**');
  return { content, chunks: chunks.length };
}

async function processEpisode(db, ep, tmpDir) {
  const audioUrl = ep.episode_url?.includes('youtube') ? ep.episode_url : ep.audio_url;
  if (!audioUrl) return 'no source';

  const audioPath = path.join(tmpDir, `ep${ep.id}.mp3`);
  try {
    // Download
    process.stdout.write('  DL... ');
    const downloaded = downloadAudio(audioUrl, audioPath);
    if (!downloaded) return 'download failed';
    const size = (fs.statSync(downloaded).size / 1024 / 1024).toFixed(0);
    process.stdout.write(`${size}MB `);

    // ASR
    process.stdout.write('ASR... ');
    const segments = runWhisper(downloaded);
    const rawText = segsToText(segments);
    db.prepare("INSERT OR REPLACE INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'zh', 'asr')").run(ep.id, rawText);

    // Polish
    process.stdout.write('Polish... ');
    const { content, chunks } = await polish(rawText, ep.podcast_name);
    db.prepare("INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'zh', 'llm_polish')").run(ep.id, content);
    return `OK (${segments.length} segs, ${chunks}ch)`;
  } finally {
    // Cleanup
    const base = audioPath.replace(/\.[^.]+$/, '');
    for (const ext of ['.mp3', '.m4a', '.opus', '.webm', '.wav']) {
      try { fs.unlinkSync(base + ext); } catch(e) {}
    }
  }
}

async function main() {
  const db = getDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asr-pri-'));

  const episodes = db.prepare(`
    SELECT e.id, e.title, e.episode_url, e.audio_url, p.name as podcast_name, p.id as podcast_id
    FROM episodes e JOIN podcasts p ON p.id=e.podcast_id
    WHERE p.id IN (${PRIORITY_IDS.join(',')})
    AND e.id NOT IN (SELECT episode_id FROM transcripts)
    AND (e.episode_url LIKE 'https://www.youtube.com%' OR e.audio_url IS NOT NULL)
    ORDER BY p.id, e.id
  `).all();

  console.log(`\n🎤 Priority ASR: ${episodes.length} episodes from podcasts ${PRIORITY_IDS.join(',')}\n`);
  const start = Date.now();
  let done = 0, failed = 0;

  // Process sequentially (GPU can only do one whisper at a time)
  // But download next while polishing current
  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i];
    const elapsed = ((Date.now() - start) / 60000).toFixed(1);
    console.log(`[${i+1}/${episodes.length}] (${elapsed}m) ${ep.podcast_name.slice(0,12)} | ${ep.title.slice(0,50)}`);
    try {
      const result = await processEpisode(db, ep, tmpDir);
      console.log(`  ${result}`);
      if (result.startsWith('OK')) done++; else failed++;
    } catch(e) {
      console.log(`  ERROR: ${e.message.slice(0,80)}`);
      failed++;
    }
  }

  try { fs.rmSync(tmpDir, { recursive: true }); } catch(e) {}
  console.log(`\n✅ ${((Date.now()-start)/60000).toFixed(1)}m: ${done} done, ${failed} failed`);
  closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
