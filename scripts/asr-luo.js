require('dotenv').config();
const { spawnSync } = require('child_process');
const fs = require('fs');
const { getDb, closeDb } = require('../server/src/db');
const db = getDb();
const LD_PATH = '/home/mhliu/miniconda3/pkgs/libcublas-12.6.4.1-0/lib:' + (process.env.LD_LIBRARY_PATH || '');

function segsToText(segments) {
  const groups = []; if (!segments.length) return '';
  let ws = segments[0].start, wt = [];
  for (const s of segments) {
    if (s.start - ws >= 60 && wt.length) { groups.push(`[${Math.floor(ws/60)}:${String(Math.floor(ws%60)).padStart(2,'0')}] ${wt.join('')}`); ws = s.start; wt = []; }
    wt.push(s.text);
  }
  if (wt.length) groups.push(`[${Math.floor(ws/60)}:${String(Math.floor(ws%60)).padStart(2,'0')}] ${wt.join('')}`);
  return groups.join('\n');
}

const eps = db.prepare(`
  SELECT e.id, e.title, e.episode_url FROM episodes e
  WHERE e.podcast_id = 17 AND e.id NOT IN (SELECT episode_id FROM transcripts)
  ORDER BY e.id
`).all();

console.log(`\n🎤 罗永浩 ASR: ${eps.length} episodes (B站 + cookies)\n`);

(async () => {
  let done = 0, failed = 0;
  for (let i = 0; i < eps.length; i++) {
    const ep = eps[i];
    console.log(`[${i+1}/${eps.length}] ep${ep.id}: ${ep.title.slice(0, 45)}`);
    const tmpFile = `/tmp/asr_luo_${ep.id}`;
    try {
      // Download from B站 with cookies
      console.log('  DL from B站...');
      const dl = spawnSync('yt-dlp', [
        '--cookies-from-browser', 'chrome',
        '-x', '--audio-format', 'mp3', '--audio-quality', '5',
        '-o', tmpFile + '.%(ext)s', '--no-playlist', '--quiet', ep.episode_url
      ], { timeout: 600000 });
      
      const dlFile = fs.readdirSync('/tmp').filter(f => f.startsWith(`asr_luo_${ep.id}`)).map(f => '/tmp/' + f).find(f => fs.statSync(f).size > 10000);
      if (!dlFile) throw new Error('Download failed');
      console.log(`  ${(fs.statSync(dlFile).size / 1024 / 1024).toFixed(0)}MB -> Whisper...`);

      // ASR
      const script = `import sys,json\nfrom faster_whisper import WhisperModel\nmodel=WhisperModel("large-v3",device="cuda",compute_type="float16")\nsegments,info=model.transcribe("${dlFile}",language="zh",beam_size=5,vad_filter=True,vad_parameters=dict(min_silence_duration_ms=500))\nresult=[]\nfor seg in segments:\n    result.append({"start":seg.start,"end":seg.end,"text":seg.text.strip()})\n    if len(result)%200==0: sys.stderr.write(f"\\r  {len(result)} segs...")\nsys.stderr.write(f"\\r  {len(result)} segs done\\n")\njson.dump(result, open("/tmp/asr_segs_out.json","w"), ensure_ascii=False); print(str(len(result))+" segs")`;
      const r = spawnSync('python3', ['-c', script], { timeout: 7200000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 50*1024*1024, env: { ...process.env, LD_LIBRARY_PATH: LD_PATH } });
      if (r.stderr) process.stderr.write(r.stderr);
      const segments = JSON.parse(require("fs").readFileSync("/tmp/asr_segs_out.json","utf8"));
      const rawText = segsToText(segments);
      db.prepare("INSERT OR REPLACE INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'zh', 'asr')").run(ep.id, rawText);
      console.log(`  OK: ${segments.length} segs, ${rawText.length} chars`);
      done++;
    } catch (e) { console.log(`  FAIL: ${e.message.slice(0, 60)}`); failed++; }
    finally { fs.readdirSync('/tmp').filter(f => f.startsWith(`asr_luo_${ep.id}`)).forEach(f => { try { fs.unlinkSync('/tmp/' + f); } catch(e) {} }); }
  }
  console.log(`\n✅ ${done} done, ${failed} failed`);
  closeDb();
})();
