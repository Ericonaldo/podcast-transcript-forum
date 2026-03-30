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
  const script = `
import os, json, torch, torchaudio, warnings
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
    timeout: 7200000, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LD_LIBRARY_PATH: LD_PATH, HF_TOKEN },
  });
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) throw new Error('Diarize failed: ' + (r.stderr || '').slice(-200));
  return JSON.parse(fs.readFileSync('/data/podcast-tmp/diarize_only_out.json', 'utf8'));
}

function vttToTimedPlain(vttContent) {
  const cues = [];
  for (const block of vttContent.split(/\n\s*\n/)) {
    const lines = block.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length || /^(WEBVTT|NOTE|STYLE|Kind:|Language:)/.test(lines[0])) continue;
    const ti = lines.findIndex(l => l.includes('-->'));
    if (ti === -1) continue;
    const m = lines[ti].match(/([\d:.]+)/);
    const secs = m ? m[1].split(':').reduce((a,v,i,arr) => a+parseFloat(v)*Math.pow(60,arr.length-1-i),0) : 0;
    const text = lines.slice(ti+1).map(l => l.replace(/<.*?>/g,'').trim()).filter(Boolean).join(' ');
    if (text) cues.push({secs, text});
  }
  if (!cues.length) return null;
  const groups = []; let ws = cues[0].secs, wt = [];
  const fmt = s => Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
  for (const c of cues) {
    if (c.secs - ws >= 30 && wt.length) { groups.push('['+fmt(ws)+'] '+wt.join(' ')); ws = c.secs; wt = []; }
    wt.push(c.text);
  }
  if (wt.length) groups.push('['+fmt(ws)+'] '+wt.join(' '));
  return groups.join('\n');
}

function mergeWithDiarize(textContent, diarizeRows) {
  const lines = textContent.split('\n').filter(l => l.trim());
  const segs = lines.map(l => {
    const m = l.match(/^\[(\d+):(\d+)\]\s*(.*)/);
    if (m) return { start: parseInt(m[1]) * 60 + parseInt(m[2]), text: m[3] };
    return { start: 0, text: l };
  });
  const result = [];
  for (const seg of segs) {
    let bestSpeaker = 'UNKNOWN'; let bestOverlap = 0;
    const segEnd = seg.start + 30;
    for (const dr of diarizeRows) {
      const overlap = Math.min(segEnd, dr.end) - Math.max(seg.start, dr.start);
      if (overlap > bestOverlap) { bestOverlap = overlap; bestSpeaker = dr.speaker; }
    }
    const ts = `[${Math.floor(seg.start/60)}:${String(Math.floor(seg.start%60)).padStart(2,'0')}]`;
    result.push(`${ts} [${bestSpeaker}] ${seg.text}`);
  }
  return result.join('\n');
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

    // Get source text
    let sourceText = ep.asr_content;
    if (!sourceText && ep.vtt_content) sourceText = vttToTimedPlain(ep.vtt_content);
    if (!sourceText) { console.log('SKIP(no source)'); skipped++; continue; }

    // Check if already has diarized version
    const existing = db.prepare("SELECT id FROM transcripts WHERE episode_id=? AND source='asr_diarized'").get(ep.id);
    if (existing && !episodeId) { console.log('SKIP(already diarized)'); skipped++; continue; }

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
      const rows = runDiarize(dlFile);

      // Merge
      const merged = mergeWithDiarize(sourceText, rows);

      // Save as asr_diarized source
      if (existing) {
        db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(merged, existing.id);
      } else {
        db.prepare("INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'zh', 'asr_diarized')").run(ep.id, merged);
      }
      console.log(`OK (${rows.length} turns, ${(merged.length/1000).toFixed(0)}k)`);
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
