require('dotenv').config();
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const { getDb, closeDb } = require('../server/src/db');
const db = getDb();

const LD_PATH = '/home/mhliu/miniconda3/pkgs/libcublas-12.6.4.1-0/lib:' + (process.env.LD_LIBRARY_PATH || '');
const EPS = [107, 116, 120, 122, 123];

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

(async () => {
  for (const epId of EPS) {
    const ep = db.prepare('SELECT title, audio_url FROM episodes WHERE id=?').get(epId);
    console.log(`\n=== ep${epId}: ${ep.title.slice(0, 50)} ===`);

    const tmpFile = `/tmp/asr_fix_${epId}.m4a`;

    // Download
    console.log('  Downloading from 小宇宙...');
    try {
      execSync(`curl -L -s -o "${tmpFile}" --max-time 300 "${ep.audio_url}"`, { timeout: 310000 });
    } catch (e) {
      console.log('  Download failed');
      continue;
    }

    if (!fs.existsSync(tmpFile) || fs.statSync(tmpFile).size < 10000) {
      console.log('  File too small or missing');
      continue;
    }
    const size = (fs.statSync(tmpFile).size / 1024 / 1024).toFixed(0);
    console.log(`  Downloaded: ${size}MB`);

    // ASR
    console.log('  Running Whisper...');
    const script = `
import sys, json
from faster_whisper import WhisperModel
model = WhisperModel("large-v3", device="cuda", compute_type="float16")
segments, info = model.transcribe("${tmpFile}", language="zh", beam_size=5, vad_filter=True, vad_parameters=dict(min_silence_duration_ms=500))
result = []
for seg in segments:
    result.append({"start": seg.start, "end": seg.end, "text": seg.text.strip()})
    if len(result) % 100 == 0:
        sys.stderr.write(f"\\r  {len(result)} segs, {seg.end:.0f}s...")
sys.stderr.write(f"\\r  {len(result)} segs done\\n")
print(json.dumps(result, ensure_ascii=False))
`;
    const r = spawnSync('python3', ['-c', script], {
      timeout: 3600000, encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, LD_LIBRARY_PATH: LD_PATH },
    });
    if (r.stderr) process.stderr.write(r.stderr);

    let segments;
    try {
      segments = JSON.parse(r.stdout);
    } catch (e) {
      console.log('  Whisper parse failed');
      continue;
    }

    const rawText = segsToText(segments);
    db.prepare("INSERT OR REPLACE INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'zh', 'asr')").run(epId, rawText);
    console.log(`  Saved: ${segments.length} segs, ${rawText.length} chars`);

    // Cleanup
    try { fs.unlinkSync(tmpFile); } catch (e) {}
  }

  closeDb();
  console.log('\n✅ Done! Run: node scripts/fast-polish.js');
})();
