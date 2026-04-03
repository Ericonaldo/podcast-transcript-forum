#!/usr/bin/env node
/**
 * Run pyannote diarization on all Chinese episodes and save speaker labels.
 * This is the GPU-intensive part - runs fast on GPU.
 * LLM polish can be done separately afterwards.
 *
 * Saves diarization results to a new 'diarize_labels' source in transcripts table,
 * in format: [MM:SS] [SPEAKER_XX] original_text
 *
 * Usage: node scripts/diarize-only-batch.js [--episode-id=96] [--podcast-id=16]
 */
require('dotenv').config();
const { spawnSync } = require('child_process');
const fs = require('fs');
const { getDb, closeDb } = require('../server/src/db');

const HF_TOKEN = process.env.HF_TOKEN;
const LD_PATH = '/home/mhliu/miniconda3/pkgs/libcublas-12.6.4.1-0/lib:' + (process.env.LD_LIBRARY_PATH || '');

const args = process.argv.slice(2);
const episodeId = args.find(a => a.startsWith('--episode-id='))?.split('=')[1];
const podcastId = args.find(a => a.startsWith('--podcast-id='))?.split('=')[1];
const forceAll = args.includes('--force');
const keepRaw = args.includes('--keep-raw');

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

function runDiarize(audioFile) {
  // First convert to 16kHz mono WAV using ffmpeg (memory-efficient, streaming)
  // This avoids loading entire audio into RAM for resampling
  const wavFile = audioFile.replace(/\.[^.]+$/, '_16k.wav');
  const ffResult = spawnSync('ffmpeg', ['-i', audioFile, '-ar', '16000', '-ac', '1', '-y', wavFile], {
    timeout: 600000, stdio: ['ignore', 'pipe', 'pipe']
  });
  if (ffResult.status !== 0) throw new Error('ffmpeg resample failed');

  const script = `
import os, json, torch, torchaudio, warnings, numpy as np
from scipy.special import expit
warnings.filterwarnings('ignore')
os.environ['HF_TOKEN'] = '${HF_TOKEN}'
os.environ['PYTORCH_CUDA_ALLOC_CONF'] = 'expandable_segments:True'
import sys

# Load pre-resampled 16kHz mono WAV (much smaller in memory)
waveform, sr = torchaudio.load("${wavFile}")
duration = waveform.shape[1] / sr

from pyannote.audio import Pipeline, Model
pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", token=os.environ['HF_TOKEN'])
pipeline.to(torch.device("cuda"))

# Lower clustering threshold for better speaker separation
try:
    params = {
        "segmentation": {"min_duration_off": 0.0},
        "clustering": {"method": "centroid", "min_cluster_size": 12, "threshold": 0.55}
    }
    pipeline.instantiate(params)
    sys.stderr.write(f"  Tuned: cluster.threshold=0.55\\n")
except Exception as e:
    sys.stderr.write(f"  Could not tune params: {e}\\n")

# Run standard diarization
result = pipeline({"waveform": waveform, "sample_rate": sr})
diarization = getattr(result, 'speaker_diarization', None) or result
rows = []
try:
    for track, _, speaker in diarization.itertracks(yield_label=True):
        rows.append({"start": track.start, "end": track.end, "speaker": speaker})
except AttributeError:
    data = result.serialize() if hasattr(result, 'serialize') else {}
    if 'speaker_diarization' in data:
        ann = data['speaker_diarization']
        for track, _, speaker in ann.itertracks(yield_label=True):
            rows.append({"start": track.start, "end": track.end, "speaker": speaker})

# Also run segmentation model to get frame-level speaker probabilities
# This lets us detect short interjections the pipeline misses
seg_model = pipeline._segmentation.model
seg_model.to(torch.device("cuda"))

# Process in 30-second chunks to avoid OOM
chunk_dur = 30.0
chunk_samples = int(chunk_dur * sr)
seg_data = []  # list of {start, end, speakers: [{slot, prob}]}

for chunk_start_s in range(0, int(duration), int(chunk_dur)):
    s_sample = int(chunk_start_s * sr)
    e_sample = min(s_sample + chunk_samples, waveform.shape[1])
    chunk = waveform[:, s_sample:e_sample]
    if chunk.shape[1] < sr:  # skip very short chunks
        continue
    with torch.no_grad():
        out = seg_model(chunk.unsqueeze(0).to(torch.device("cuda")))
    probs = expit(out.squeeze(0).cpu().numpy())
    num_frames = probs.shape[0]
    actual_dur = chunk.shape[1] / sr
    step = actual_dur / num_frames

    # For each frame, record if there's significant secondary speaker activity
    # We only care about frames where a secondary speaker has prob > 0.15
    for fi in range(num_frames):
        t = chunk_start_s + fi * step
        p = probs[fi]
        # Find top 2 speakers by probability
        sorted_idx = np.argsort(p)[::-1]
        top_prob = p[sorted_idx[0]]
        sec_prob = p[sorted_idx[1]] if len(sorted_idx) > 1 else 0
        if sec_prob > 0.20 and top_prob > 0.3:
            seg_data.append({"t": round(t, 3), "primary": int(sorted_idx[0]), "pp": round(float(top_prob), 3), "secondary": int(sorted_idx[1]), "sp": round(float(sec_prob), 3)})

json.dump(rows, open("/data/podcast-tmp/diarize_only_out.json", "w"))
json.dump(seg_data, open("/data/podcast-tmp/seg_frames_out.json", "w"))
sys.stderr.write(f"  Diarized: {len(rows)} turns, {len(seg_data)} interjection frames\\n")
print(f"{len(rows)} turns")
`;
  const r = spawnSync('python3', ['-c', script], {
    timeout: 7200000, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LD_LIBRARY_PATH: LD_PATH, HF_TOKEN },
  });
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) throw new Error('Diarize failed: ' + (r.stderr || '').slice(-200));
  const diarizeRows = JSON.parse(fs.readFileSync('/data/podcast-tmp/diarize_only_out.json', 'utf8'));
  let segFrames = [];
  try { segFrames = JSON.parse(fs.readFileSync('/data/podcast-tmp/seg_frames_out.json', 'utf8')); } catch(e) {}
  return { diarizeRows, segFrames };
}

function vttToTimedPlain(vttContent) {
  // Parse VTT into individual cues with precise start/end times
  const cues = [];
  for (const block of vttContent.split(/\n\s*\n/)) {
    const lines = block.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length || /^(WEBVTT|NOTE|STYLE|Kind:|Language:)/.test(lines[0])) continue;
    const ti = lines.findIndex(l => l.includes('-->'));
    if (ti === -1) continue;
    const tm = lines[ti].match(/([\d:.]+)\s*-->\s*([\d:.]+)/);
    if (!tm) continue;
    const parse = s => s.split(':').reduce((a,v,i,arr) => a+parseFloat(v)*Math.pow(60,arr.length-1-i),0);
    const start = parse(tm[1]), end = parse(tm[2]);
    const text = lines.slice(ti+1).map(l => l.replace(/<\d{1,2}:\d{2}:\d{2}[.,]\d{3}>/g,'').replace(/<\/?[a-z][^>]*>/gi,'').trim()).filter(Boolean).join(' ');
    if (text) cues.push({start, end, text});
  }
  if (!cues.length) return null;

  // Return per-cue segments (no grouping!) to preserve maximum speaker turn precision
  const fmt = s => Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
  return cues.map(c => ({start: c.start, end: c.end, text: '['+fmt(c.start)+'] '+c.text}));
}

function mergeWithDiarize(segments, diarizeRows, segFrames) {
  // Step 1: Assign speaker to each segment using best-overlap matching
  const assigned = [];
  const allSpeakers = [...new Set(diarizeRows.map(r => r.speaker))];

  for (const seg of segments) {
    let bestSpeaker = 'UNKNOWN';
    let bestOverlap = 0;
    const segStart = seg.start;
    const segEnd = seg.end || seg.start + 2;

    for (const dr of diarizeRows) {
      if (dr.start > segEnd + 1) break; // diarizeRows sorted by start
      const overlap = Math.min(segEnd, dr.end) - Math.max(segStart, dr.start);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSpeaker = dr.speaker;
      }
    }

    // For short cues (< 3s), check segmentation model for secondary speaker activity
    // This catches interjections (嗯, 对, etc.) that the pipeline missed
    // Check slightly before cue start too, as speaker changes often precede text
    const cueDur = segEnd - segStart;
    if (cueDur < 3 && segFrames && segFrames.length > 0 && allSpeakers.length === 2) {
      const checkStart = segStart - 0.5; // look 0.5s before cue
      const cueFrames = segFrames.filter(f => f.t >= checkStart && f.t <= segEnd);
      if (cueFrames.length > 0) {
        const totalFramesInCue = Math.max(1, Math.round((cueDur + 0.5) * 59));
        const ratio = cueFrames.length / totalFramesInCue;
        if (ratio > 0.35) {
          const otherSpeaker = allSpeakers.find(s => s !== bestSpeaker);
          if (otherSpeaker) bestSpeaker = otherSpeaker;
        }
      }
    }

    const textPart = typeof seg.text === 'string' && seg.text.startsWith('[') ? seg.text.replace(/^\[\d+:\d+\]\s*/, '') : seg.text;
    assigned.push({ start: segStart, speaker: bestSpeaker, text: textPart });
  }

  // Step 2: Group consecutive same-speaker cues into paragraphs
  const result = [];
  let groupStart = null, groupSpeaker = null, groupTexts = [];

  for (const a of assigned) {
    if (groupSpeaker !== null && (a.speaker !== groupSpeaker || a.start - groupStart >= 60)) {
      const ts = `[${Math.floor(groupStart/60)}:${String(Math.floor(groupStart%60)).padStart(2,'0')}]`;
      result.push(`${ts} [${groupSpeaker}] ${groupTexts.join(' ')}`);
      groupTexts = [];
      groupStart = null;
    }
    if (groupStart === null) groupStart = a.start;
    groupSpeaker = a.speaker;
    groupTexts.push(a.text);
  }
  if (groupTexts.length) {
    const ts = `[${Math.floor(groupStart/60)}:${String(Math.floor(groupStart%60)).padStart(2,'0')}]`;
    result.push(`${ts} [${groupSpeaker}] ${groupTexts.join(' ')}`);
  }
  return result.join('\n');
}

function asrToSegments(asrContent) {
  // Convert ASR [MM:SS] text format to segments with start times
  return asrContent.split('\n').filter(l => l.trim()).map(l => {
    const m = l.match(/^\[(\d+):(\d+)\]\s*(.*)/);
    if (m) return { start: parseInt(m[1]) * 60 + parseInt(m[2]), end: parseInt(m[1]) * 60 + parseInt(m[2]) + 30, text: m[3] };
    return { start: 0, end: 30, text: l };
  });
}

async function main() {
  const db = getDb();
  const where = episodeId ? `AND e.id=${parseInt(episodeId)}` : podcastId ? `AND p.id=${parseInt(podcastId)}` : "AND p.language LIKE 'zh%'";
  
  const episodes = db.prepare(`
    SELECT e.id, e.title, e.episode_url, e.audio_url, p.name as podcast_name,
           (SELECT content FROM transcripts WHERE episode_id=e.id AND source='asr' ORDER BY created_at DESC LIMIT 1) as asr_content,
           (SELECT content FROM transcripts WHERE episode_id=e.id AND format='vtt' ORDER BY LENGTH(content) ASC LIMIT 1) as vtt_content
    FROM episodes e JOIN podcasts p ON p.id=e.podcast_id
    WHERE 1=1 ${where}
    AND e.id IN (SELECT episode_id FROM transcripts)
    AND (e.episode_url IS NOT NULL OR e.audio_url IS NOT NULL)
    ORDER BY p.id, e.id
  `).all();

  console.log(`\n🎤 Diarize-only batch: ${episodes.length} episodes\n`);
  const start = Date.now(); let done = 0, failed = 0, skipped = 0;

  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i];
    const elapsed = ((Date.now() - start) / 60000).toFixed(1);
    process.stdout.write(`[${i+1}/${episodes.length}] (${elapsed}m) ${ep.podcast_name?.slice(0,12)} | ${ep.title.slice(0,40)}... `);

    // Get source segments (array of {start, end, text})
    let sourceSegments = null;
    if (ep.vtt_content) {
      sourceSegments = vttToTimedPlain(ep.vtt_content); // returns array of segments with precise times
    }
    if (!sourceSegments && ep.asr_content) {
      sourceSegments = asrToSegments(ep.asr_content); // convert ASR to segments
    }
    if (!sourceSegments || sourceSegments.length === 0) { console.log('SKIP(no source)'); skipped++; continue; }

    // Check if already has diarized version
    const existing = db.prepare("SELECT id FROM transcripts WHERE episode_id=? AND source='asr_diarized'").get(ep.id);
    if (existing && !episodeId && !forceAll) { console.log('SKIP(already diarized)'); skipped++; continue; }

    const audioUrl = ep.audio_url || ep.episode_url;
    const tmpBase = `/data/podcast-tmp/diar_${ep.id}`;

    try {
      // Download
      process.stdout.write('DL... ');
      const dlFile = downloadAudio(audioUrl, tmpBase);
      if (!dlFile) { console.log('DL FAIL'); failed++; continue; }
      const size = (fs.statSync(dlFile).size / 1024 / 1024).toFixed(0);
      process.stdout.write(`${size}MB `);

      // Diarize
      process.stdout.write('Diarize... ');
      const { diarizeRows, segFrames } = runDiarize(dlFile);

      // Merge (precise time matching + interjection detection)
      const merged = mergeWithDiarize(sourceSegments, diarizeRows, segFrames);

      // Save as asr_diarized source
      if (existing) {
        db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(merged, existing.id);
      } else {
        db.prepare("INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'zh', 'asr_diarized')").run(ep.id, merged);
      }
      console.log(`OK (${diarizeRows.length} turns, ${segFrames.length} seg frames, ${(merged.length/1000).toFixed(0)}k)`);
      done++;
    } catch (e) {
      console.log(`ERROR: ${e.message.slice(0, 60)}`);
      failed++;
    } finally {
      fs.readdirSync('/data/podcast-tmp').filter(f => f.startsWith(`diar_${ep.id}`)).forEach(f => {
        try { fs.unlinkSync('/data/podcast-tmp/' + f); } catch (e) {}
      });
      try { fs.unlinkSync('/data/podcast-tmp/diarize_only_out.json'); } catch (e) {}
    }
  }

  console.log(`\n✅ ${((Date.now()-start)/60000).toFixed(1)}m: ${done} diarized, ${failed} failed, ${skipped} skipped`);
  closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
