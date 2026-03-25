#!/usr/bin/env node
/**
 * ASR + Speaker Diarization Pipeline
 * Uses whisperx (transcribe + align) + pyannote (diarize) + LLM (polish)
 *
 * Usage: node scripts/asr-diarize.js [--podcast-id=16] [--episode-id=166] [--no-polish]
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
const episodeId = args.find(a => a.startsWith('--episode-id='))?.split('=')[1];
const noPolish = args.includes('--no-polish');
const reprocess = args.includes('--reprocess'); // re-do even if transcript exists

function runWhisperxDiarize(audioFile) {
  const script = `
import os, json, torch, torchaudio, whisperx, warnings, pandas as pd
warnings.filterwarnings('ignore')
os.environ['HF_TOKEN'] = '${HF_TOKEN}'

device = "cuda"
audio_file = "${audioFile}"

# 1. Load audio
waveform, sr = torchaudio.load(audio_file)
audio_np = whisperx.load_audio(audio_file)

# 2. Transcribe
model = whisperx.load_model("large-v3", device, compute_type="float16", language="zh")
result = model.transcribe(audio_np, batch_size=16, language="zh")
n_segs = len(result['segments'])
import sys; sys.stderr.write(f"  Transcribed: {n_segs} segments\\n")

# 3. Align
model_a, metadata = whisperx.load_align_model(language_code="zh", device=device)
result = whisperx.align(result["segments"], model_a, metadata, audio_np, device)

# 4. Diarize
from pyannote.audio import Pipeline
diarize_pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", token=os.environ['HF_TOKEN'])
diarize_pipeline.to(torch.device(device))
diarize_output = diarize_pipeline({"waveform": waveform.to(device), "sample_rate": sr})
sd = diarize_output.speaker_diarization
rows = []
for track, _, speaker in sd.itertracks(yield_label=True):
    rows.append({"start": track.start, "end": track.end, "speaker": speaker})
diarize_df = pd.DataFrame(rows)
speakers = diarize_df['speaker'].unique().tolist() if len(diarize_df) > 0 else []
sys.stderr.write(f"  Diarized: {len(diarize_df)} turns, {len(speakers)} speakers\\n")

# 5. Assign speakers
result = whisperx.assign_word_speakers(diarize_df, result)

# Output: segments with speaker labels
output = []
for seg in result["segments"]:
    output.append({
        "start": seg.get("start", 0),
        "end": seg.get("end", 0),
        "text": seg.get("text", "").strip(),
        "speaker": seg.get("speaker", "UNKNOWN")
    })
json.dump(output, open("/tmp/asr_diarize_out.json", "w"), ensure_ascii=False)
sys.stderr.write(f"  Output: {len(output)} segments\\n")
print(f"{len(output)} segments, {len(speakers)} speakers: {','.join(speakers)}")
`;
  const r = spawnSync('python3', ['-c', script], {
    timeout: 7200000, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, LD_LIBRARY_PATH: LD_PATH, HF_TOKEN },
  });
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) throw new Error('whisperx failed: ' + (r.stderr || '').slice(-200));
  return JSON.parse(fs.readFileSync('/tmp/asr_diarize_out.json', 'utf8'));
}

function segsToText(segments) {
  // Group into ~60s paragraphs with speaker labels
  const groups = [];
  if (!segments.length) return '';
  let ws = segments[0].start, wt = [], lastSpeaker = segments[0].speaker;

  for (const s of segments) {
    // New paragraph on speaker change or every 60s
    if ((s.speaker !== lastSpeaker || s.start - ws >= 60) && wt.length > 0) {
      const ts = `[${Math.floor(ws / 60)}:${String(Math.floor(ws % 60)).padStart(2, '0')}]`;
      groups.push(`${ts} [${lastSpeaker}] ${wt.join('')}`);
      ws = s.start;
      wt = [];
    }
    lastSpeaker = s.speaker;
    wt.push(s.text);
  }
  if (wt.length) {
    const ts = `[${Math.floor(ws / 60)}:${String(Math.floor(ws % 60)).padStart(2, '0')}]`;
    groups.push(`${ts} [${lastSpeaker}] ${wt.join('')}`);
  }
  return groups.join('\n');
}

async function polishTranscript(rawText, podcastName, episodeTitle, episodeDesc) {
  const descHint = episodeDesc ? `\n\n节目简介（参考嘉宾姓名）：${episodeDesc.slice(0, 300)}` : '';
  const sys = `你是播客文字稿编辑器。文稿中已有说话人标签（如[SPEAKER_00]、[SPEAKER_01]），请将其替换为真实姓名。

播客：${podcastName}
本期：${episodeTitle}${descHint}

要求：
1. 根据节目简介和内容，将SPEAKER_XX替换为真实姓名，用**[真名]**格式标记
2. 姓名必须与节目简介中提到的嘉宾名字一致（注意同音字！）
3. 添加标点符号
4. 保留[MM:SS]时间戳
5. 不改变原意
6. 修正语音识别错误

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
  let speakerMap = '';
  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(`P${i + 1}/${chunks.length} `);
    const hint = i > 0 && speakerMap ? `\n\n(Part ${i + 1}/${chunks.length}. ${speakerMap})` : '';
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: LLM_MODEL, messages: [{ role: 'system', content: sys }, { role: 'user', content: chunks[i] + hint }], max_tokens: 4096 })
    });
    if (!r.ok) throw new Error('LLM API ' + r.status);
    const d = await r.json();
    const polished = d?.choices?.[0]?.message?.content || chunks[i];
    results.push(polished);
    // Extract speaker mapping for consistency
    const names = new Set();
    let m;
    const re = /\*\*\[([^\]]+)\]\*\*/g;
    while ((m = re.exec(polished)) !== null) names.add(m[1]);
    if (names.size > 0) speakerMap = 'Use these exact names: ' + [...names].join(', ');
  }

  let content = results.join('\n\n');
  // Normalize tags
  content = content.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*[：:]\s*/g, '$1**[$2]** ');
  content = content.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*(\s)/g, (m, pre, name, sp) => pre + '**[' + name.trim() + ']**' + sp);
  content = content.replace(/\*\*\[([^\]]+)\]\s*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\*\*/g, '**[$1]** [$2]');
  content = content.replace(/^\*\*\[[^\]]+\]\*\*\s*$/gm, '').replace(/\n{3,}/g, '\n\n');
  return content;
}

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

async function processEpisode(db, ep) {
  const audioUrl = ep.audio_url || ep.episode_url;
  if (!audioUrl) return 'no audio source';

  const tmpBase = `/tmp/asr_d_${ep.id}`;

  try {
    // Download
    process.stdout.write('  DL... ');
    const dlFile = downloadAudio(audioUrl, tmpBase);
    if (!dlFile) return 'download failed';
    const size = (fs.statSync(dlFile).size / 1024 / 1024).toFixed(0);
    process.stdout.write(`${size}MB `);

    // ASR + Diarize
    process.stdout.write('ASR+Diarize... ');
    const segments = runWhisperxDiarize(dlFile);
    const rawText = segsToText(segments);

    // Save raw ASR with speaker labels
    db.prepare("INSERT OR REPLACE INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'zh', 'asr')").run(ep.id, rawText);

    if (!noPolish) {
      // Polish: map SPEAKER_XX to real names
      process.stdout.write('Polish... ');
      const polished = await polishTranscript(rawText, ep.podcast_name, ep.title, ep.description);
      const existing = db.prepare("SELECT id FROM transcripts WHERE episode_id=? AND source='llm_polish'").get(ep.id);
      if (existing) {
        db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(polished, existing.id);
      } else {
        db.prepare("INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'zh', 'llm_polish')").run(ep.id, polished);
      }
    }

    return `OK (${segments.length} segs, ${rawText.length} chars)`;
  } finally {
    // Cleanup
    fs.readdirSync('/tmp').filter(f => f.startsWith(`asr_d_${ep.id}`)).forEach(f => {
      try { fs.unlinkSync('/tmp/' + f); } catch (e) {}
    });
    try { fs.unlinkSync('/tmp/asr_diarize_out.json'); } catch (e) {}
  }
}

async function main() {
  const db = getDb();

  let episodes;
  if (episodeId) {
    episodes = db.prepare(`
      SELECT e.id, e.title, e.episode_url, e.audio_url, p.name as podcast_name
      FROM episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE e.id=?
    `).all(parseInt(episodeId));
  } else {
    const where = podcastId ? `AND p.id=${parseInt(podcastId)}` : "AND p.language LIKE 'zh%'";
    const havingClause = reprocess ? '' : 'AND e.id NOT IN (SELECT episode_id FROM transcripts)';
    episodes = db.prepare(`
      SELECT e.id, e.title, e.episode_url, e.audio_url, p.name as podcast_name
      FROM episodes e JOIN podcasts p ON p.id=e.podcast_id
      WHERE 1=1 ${where} ${havingClause}
      AND (e.episode_url IS NOT NULL OR e.audio_url IS NOT NULL)
      ORDER BY p.id, e.id
    `).all();
  }

  console.log(`\n🎤 ASR + Diarize: ${episodes.length} episodes${noPolish ? ' (no polish)' : ''}\n`);
  const start = Date.now();
  let done = 0, failed = 0;

  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i];
    const elapsed = ((Date.now() - start) / 60000).toFixed(1);
    console.log(`[${i + 1}/${episodes.length}] (${elapsed}m) ${ep.podcast_name?.slice(0, 10)} | ${ep.title.slice(0, 45)}`);
    try {
      const result = await processEpisode(db, ep);
      console.log(`  ${result}`);
      if (result.startsWith('OK')) done++;
      else failed++;
    } catch (e) {
      console.log(`  ERROR: ${e.message.slice(0, 80)}`);
      failed++;
    }
  }

  console.log(`\n✅ ${((Date.now() - start) / 60000).toFixed(1)}m: ${done} done, ${failed} failed`);
  closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
