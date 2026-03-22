require('dotenv').config();
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const { getDb, closeDb } = require('../server/src/db');
const db = getDb();

const LD_PATH = '/home/mhliu/miniconda3/pkgs/libcublas-12.6.4.1-0/lib:' + (process.env.LD_LIBRARY_PATH || '');

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

// Get all 张小珺 episodes needing ASR
const eps = db.prepare(`
  SELECT e.id, e.title, e.episode_url, e.audio_url
  FROM episodes e WHERE e.podcast_id = 16
  AND e.id NOT IN (SELECT episode_id FROM transcripts)
  ORDER BY e.id
`).all();

console.log(`\n🎤 ASR for ${eps.length} 张小珺 episodes\n`);

(async () => {
  let done = 0, failed = 0;
  for (let i = 0; i < eps.length; i++) {
    const ep = eps[i];
    const audioUrl = ep.audio_url || ep.episode_url;
    if (!audioUrl) { console.log(`[${i+1}/${eps.length}] ep${ep.id}: NO SOURCE`); failed++; continue; }

    console.log(`[${i+1}/${eps.length}] ep${ep.id}: ${ep.title.slice(0, 50)}`);
    const tmpFile = `/tmp/asr_zxj_${ep.id}.m4a`;

    try {
      // Download
      console.log('  Downloading...');
      if (audioUrl.includes('youtube')) {
        // YouTube might be blocked, try anyway
        const r = spawnSync('yt-dlp', ['-x', '--audio-format', 'mp3', '--audio-quality', '5', '-o', tmpFile.replace('.m4a', '.%(ext)s'), '--no-playlist', '--quiet', audioUrl], { timeout: 300000 });
        const dl = ['.mp3', '.m4a', '.opus', '.webm'].map(e => tmpFile.replace('.m4a', e)).find(f => fs.existsSync(f));
        if (!dl) throw new Error('YouTube download failed');
      } else {
        execSync(`curl -L -s -o "${tmpFile}" --max-time 300 "${audioUrl}"`, { timeout: 310000 });
      }

      const dlFile = fs.readdirSync('/tmp').filter(f => f.startsWith(`asr_zxj_${ep.id}`)).map(f => '/tmp/' + f)[0];
      if (!dlFile || fs.statSync(dlFile).size < 10000) throw new Error('Download too small');
      console.log(`  Downloaded: ${(fs.statSync(dlFile).size / 1024 / 1024).toFixed(0)}MB`);

      // ASR
      console.log('  Whisper...');
      const script = `import sys,json\nfrom faster_whisper import WhisperModel\nmodel=WhisperModel("large-v3",device="cuda",compute_type="float16")\nsegments,info=model.transcribe("${dlFile}",language="zh",beam_size=5,vad_filter=True,vad_parameters=dict(min_silence_duration_ms=500))\nresult=[]\nfor seg in segments:\n    result.append({"start":seg.start,"end":seg.end,"text":seg.text.strip()})\n    if len(result)%100==0: sys.stderr.write(f"\\r  {len(result)} segs, {seg.end:.0f}s...")\nsys.stderr.write(f"\\r  {len(result)} segs done\\n")\nprint(json.dumps(result,ensure_ascii=False))`;
      const r = spawnSync('python3', ['-c', script], { timeout: 3600000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 50*1024*1024, env: { ...process.env, LD_LIBRARY_PATH: LD_PATH } });
      if (r.stderr) process.stderr.write(r.stderr);
      const segments = JSON.parse(r.stdout);
      const rawText = segsToText(segments);

      db.prepare("INSERT OR REPLACE INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'zh', 'asr')").run(ep.id, rawText);
      console.log(`  Saved: ${segments.length} segs, ${rawText.length} chars`);
      done++;
    } catch (e) {
      console.log(`  ERROR: ${e.message.slice(0, 80)}`);
      failed++;
    } finally {
      // Cleanup
      fs.readdirSync('/tmp').filter(f => f.startsWith(`asr_zxj_${ep.id}`)).forEach(f => { try { fs.unlinkSync('/tmp/' + f); } catch(e) {} });
    }
  }
  console.log(`\n✅ Done: ${done} success, ${failed} failed`);
  console.log('Run: node scripts/fast-polish.js');
  closeDb();
})();
