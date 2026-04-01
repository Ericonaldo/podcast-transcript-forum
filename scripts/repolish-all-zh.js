#!/usr/bin/env node
/**
 * Re-polish ALL Chinese podcast transcripts using the new ASR+Diarize pipeline.
 * For episodes that already have ASR/VTT transcripts, re-processes with diarization.
 *
 * Usage: node scripts/repolish-all-zh.js [--podcast-id=16]
 */
require('dotenv').config();
const { spawnSync } = require('child_process');
const fs = require('fs');
const { getDb, closeDb } = require('../server/src/db');

const API_KEY = process.env.LLM_API_KEY;
const API_URL = process.env.LLM_API_URL || 'http://38.246.250.87:3000/v1/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const HF_TOKEN = process.env.HF_TOKEN;
const LD_PATH = '/home/mhliu/miniconda3/pkgs/libcublas-12.6.4.1-0/lib:' + (process.env.LD_LIBRARY_PATH || '');
const CHUNK_SIZE = 3000;

const args = process.argv.slice(2);
const podcastId = args.find(a => a.startsWith('--podcast-id='))?.split('=')[1];

function downloadAudio(url, outFile) {
  if (url.includes('bilibili')) {
    spawnSync('yt-dlp', ['--cookies-from-browser', 'chrome', '-x', '--audio-format', 'mp3', '-o', outFile + '.%(ext)s', '--no-playlist', '--quiet', url], { timeout: 600000 });
  } else if (url.includes('youtube')) {
    spawnSync('yt-dlp', ['-x', '--audio-format', 'mp3', '-o', outFile + '.%(ext)s', '--no-playlist', '--quiet', url], { timeout: 600000 });
  } else {
    const { execSync } = require('child_process');
    execSync(`curl -L -s -o "${outFile}.m4a" --max-time 600 "${url}"`, { timeout: 610000 });
  }
  const dir = require('path').dirname(outFile);
  const base = require('path').basename(outFile);
  return fs.readdirSync(dir).filter(f => f.startsWith(base)).map(f => dir + '/' + f).find(f => fs.statSync(f).size > 10000);
}

function runDiarizeOnly(audioFile) {
  // Only run diarization (not full ASR) - faster for re-processing
  const script = `
import os, json, torch, torchaudio, warnings, pandas as pd
warnings.filterwarnings('ignore')
os.environ['HF_TOKEN'] = '${HF_TOKEN}'
device = "cuda"
waveform, sr = torchaudio.load("${audioFile}")
from pyannote.audio import Pipeline
pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", token=os.environ['HF_TOKEN'])
pipeline.to(torch.device(device))
result = pipeline({"waveform": waveform.to(device), "sample_rate": sr})
sd = result.speaker_diarization
rows = []
for track, _, speaker in sd.itertracks(yield_label=True):
    rows.append({"start": track.start, "end": track.end, "speaker": speaker})
json.dump(rows, open("/data/podcast-tmp/diarize_only_out.json", "w"))
import sys; sys.stderr.write(f"  Diarized: {len(rows)} turns\\n")
print(f"{len(rows)} turns")
`;
  const r = spawnSync('python3', ['-c', script], {
    timeout: 3600000, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LD_LIBRARY_PATH: LD_PATH, HF_TOKEN },
  });
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) throw new Error('Diarize failed');
  return JSON.parse(fs.readFileSync('/data/podcast-tmp/diarize_only_out.json', 'utf8'));
}

function mergeASRWithDiarize(asrContent, diarizeRows) {
  // Parse ASR text into timed segments
  const asrLines = asrContent.split('\n').filter(l => l.trim());
  const asrSegs = asrLines.map(l => {
    const m = l.match(/^\[(\d+):(\d+)\]\s*(.*)/);
    if (m) return { start: parseInt(m[1]) * 60 + parseInt(m[2]), text: m[3] };
    return { start: 0, text: l };
  });

  // For each ASR segment, find the dominant speaker from diarization
  const result = [];
  for (const seg of asrSegs) {
    let bestSpeaker = 'UNKNOWN';
    let bestOverlap = 0;
    const segEnd = seg.start + 60; // approximate 60s window

    for (const dr of diarizeRows) {
      const overlap = Math.min(segEnd, dr.end) - Math.max(seg.start, dr.start);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSpeaker = dr.speaker;
      }
    }
    const ts = `[${Math.floor(seg.start / 60)}:${String(Math.floor(seg.start % 60)).padStart(2, '0')}]`;
    result.push(`${ts} [${bestSpeaker}] ${seg.text}`);
  }
  return result.join('\n');
}

async function polishWithSpeakers(rawText, podcastName, episodeTitle, episodeDesc) {
  // Extract guest names from description if available
  const descHint = episodeDesc ? `\n\n节目简介（参考嘉宾姓名）：${episodeDesc.slice(0, 300)}` : '';
  const sys = `你是播客文字稿编辑器。以下文稿已标注了说话人ID（如[SPEAKER_00]）。

播客：${podcastName}
本期：${episodeTitle}${descHint}

严格要求：
1. 将[SPEAKER_XX]替换为真实姓名，用**[真名]**格式（参考节目简介，注意同音字！）
2. 添加标点符号
3. **保留原文所有文字和顺序不变**，不要删减、改写或重新组织内容
4. 在每次说话人切换处必须分段并标注新说话人（即使原文是同一大段，也要在问答切换处拆开）
5. 检测段内问答交替：如果一段包含提问+回答，必须拆为两个说话人的段落
6. 同一说话人的连续内容可以合并，每段至少50字
7. 修正明显的语音识别错误（同音字等）
8. 段落内不要出现"XXX："这样的说话人标记，必须拆为独立的**[XXX]**段落
9. **关键：说话人标签必须严格使用**[姓名]**格式，绝不使用**姓名:**或**姓名：**或**姓名**格式**

只输出处理后的文稿。`;

  const lines = rawText.split('\n');
  const chunks = [];
  let cur = '';
  for (const l of lines) {
    if (cur.length + l.length > CHUNK_SIZE && cur.length > 0) { chunks.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + l;
  }
  if (cur) chunks.push(cur);

  const MODELS = [LLM_MODEL, 'gpt-4o-mini', 'deepseek-v3', 'gpt-4o']; // fallback chain
  async function callLLMWithRetry(messages) {
    for (const model of MODELS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, max_tokens: 4096 })
          });
          if (!r.ok) { await new Promise(r => setTimeout(r, 3000)); continue; }
          const d = await r.json();
          return d?.choices?.[0]?.message?.content || null;
        } catch (e) { await new Promise(r => setTimeout(r, 5000)); }
      }
    }
    return null;
  }

  const results = [];
  let speakerMap = '';
  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(`P${i + 1} `);
    const hint = i > 0 && speakerMap ? `\n\n(Part ${i + 1}/${chunks.length}. ${speakerMap})` : '';
    const p = await callLLMWithRetry([{ role: 'system', content: sys }, { role: 'user', content: chunks[i] + hint }]);
    if (!p) throw new Error('All LLM models failed');
    results.push(p);
    const names = new Set();
    let m;
    const re = /\*\*\[([^\]]+)\]\*\*/g;
    while ((m = re.exec(p)) !== null) names.add(m[1]);
    if (names.size > 0) speakerMap = 'Use these exact names: ' + [...names].join(', ');
  }

  let content = results.join('\n\n');
  content = content.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*[：:]\s*/g, '$1**[$2]** ');
  content = content.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*(\s)/g, (m, pre, name, sp) => pre + '**[' + name.trim() + ']**' + sp);
  content = content.replace(/\*\*\[([^\]]+)\]\s*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\*\*/g, '**[$1]** [$2]');
  content = content.replace(/^\*\*\[[^\]]+\]\*\*\s*$/gm, '').replace(/\n{3,}/g, '\n\n');
  return content;
}

async function main() {
  const db = getDb();

  const where = podcastId ? `AND p.id=${parseInt(podcastId)}` : "AND p.language LIKE 'zh%'";
  const episodes = db.prepare(`
    SELECT e.id, e.title, e.description, e.episode_url, e.audio_url, p.name as podcast_name,
           (SELECT content FROM transcripts WHERE episode_id=e.id AND source='asr' LIMIT 1) as asr_content
    FROM episodes e JOIN podcasts p ON p.id=e.podcast_id
    WHERE 1=1 ${where}
    AND e.id IN (SELECT episode_id FROM transcripts)
    AND (e.episode_url IS NOT NULL OR e.audio_url IS NOT NULL)
    ORDER BY p.id, e.id
  `).all();

  console.log(`\n🔄 Re-polish with Diarization: ${episodes.length} episodes\n`);
  const start = Date.now();
  let done = 0, failed = 0;

  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i];
    const elapsed = ((Date.now() - start) / 60000).toFixed(1);
    console.log(`[${i + 1}/${episodes.length}] (${elapsed}m) ${ep.podcast_name?.slice(0, 10)} | ${ep.title.slice(0, 45)}`);

    if (!ep.asr_content) {
      console.log('  SKIP: no ASR transcript');
      continue;
    }

    const audioUrl = ep.audio_url || ep.episode_url;
    const tmpBase = `/data/podcast-tmp/rpol_${ep.id}`;

    try {
      // Download audio for diarization
      process.stdout.write('  DL... ');
      const dlFile = downloadAudio(audioUrl, tmpBase);
      if (!dlFile) { console.log('download failed'); failed++; continue; }
      const size = (fs.statSync(dlFile).size / 1024 / 1024).toFixed(0);
      process.stdout.write(`${size}MB `);

      // Run diarization only (ASR already exists)
      process.stdout.write('Diarize... ');
      const diarizeRows = runDiarizeOnly(dlFile);

      // Merge ASR text with speaker labels
      const mergedText = mergeASRWithDiarize(ep.asr_content, diarizeRows);

      // Polish with LLM
      process.stdout.write('Polish... ');
      const polished = await polishWithSpeakers(mergedText, ep.podcast_name, ep.title, ep.description);

      // Save
      const existing = db.prepare("SELECT id FROM transcripts WHERE episode_id=? AND source='llm_polish'").get(ep.id);
      if (existing) {
        db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(polished, existing.id);
      } else {
        db.prepare("INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'zh', 'llm_polish')").run(ep.id, polished);
      }
      console.log(`\n  OK (${polished.length} chars)`);
      done++;
    } catch (e) {
      console.log(`\n  ERROR: ${e.message.slice(0, 80)}`);
      failed++;
    } finally {
      fs.readdirSync('/data/podcast-tmp').filter(f => f.startsWith(`rpol_${ep.id}`)).forEach(f => {
        try { fs.unlinkSync('/data/podcast-tmp/' + f); } catch (e) {}
      });
      try { fs.unlinkSync('/data/podcast-tmp/diarize_only_out.json'); } catch (e) {}
    }
  }

  console.log(`\n✅ ${((Date.now() - start) / 60000).toFixed(1)}m: ${done} done, ${failed} failed`);
  closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
