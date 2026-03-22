#!/bin/bash
# ASR single episode: download from YouTube, whisper, save to DB, polish
# Usage: bash scripts/asr-single.sh <episode_id> [<episode_id> ...]
set -e
cd /home/mhliu/podcast-transcript-forum
export LD_LIBRARY_PATH="/home/mhliu/miniconda3/pkgs/libcublas-12.6.4.1-0/lib:$LD_LIBRARY_PATH"

API_KEY="sk-3ODOY96LmDCFgcBY1d1b586c01E448BcAbB5115bD8FbD2Fc"
API_URL="http://38.246.250.87:3000/v1/chat/completions"

for EP_ID in "$@"; do
  echo ""
  echo "=== Processing ep${EP_ID} ==="

  # Get YouTube URL
  YT_URL=$(node -e "require('dotenv').config();const{getDb,closeDb}=require('./server/src/db');const db=getDb();const ep=db.prepare('SELECT episode_url,audio_url FROM episodes WHERE id=?').get(${EP_ID});console.log(ep?.audio_url||ep?.episode_url||'');closeDb();" 2>/dev/null)

  if [ -z "$YT_URL" ]; then
    echo "  No URL for ep${EP_ID}, skip"
    continue
  fi
  echo "  URL: $YT_URL"

  # Download
  TMPFILE="/tmp/asr_ep${EP_ID}.mp3"
  echo "  Downloading..."
  yt-dlp -x --audio-format mp3 --audio-quality 5 -o "${TMPFILE%.mp3}.%(ext)s" --no-playlist --quiet "$YT_URL" 2>/dev/null

  # Find downloaded file
  DLFILE=$(ls /tmp/asr_ep${EP_ID}.* 2>/dev/null | head -1)
  if [ -z "$DLFILE" ]; then
    echo "  Download failed"
    continue
  fi
  SIZE=$(du -h "$DLFILE" | cut -f1)
  echo "  Downloaded: $SIZE"

  # ASR
  echo "  Running Whisper..."
  python3 -c "
import sys, json
from faster_whisper import WhisperModel
model = WhisperModel('large-v3', device='cuda', compute_type='float16')
segments, info = model.transcribe('${DLFILE}', language='zh', beam_size=5, vad_filter=True, vad_parameters=dict(min_silence_duration_ms=500))
result = []
for seg in segments:
    result.append({'start': seg.start, 'end': seg.end, 'text': seg.text.strip()})
    if len(result) % 100 == 0:
        sys.stderr.write(f'\r  {len(result)} segs, {seg.end:.0f}s...')
sys.stderr.write(f'\r  {len(result)} segs done\n')
print(json.dumps(result, ensure_ascii=False))
" > "/tmp/asr_ep${EP_ID}.json" 2>&1

  # Save to DB
  echo "  Saving to DB..."
  node -e "
require('dotenv').config();
const fs=require('fs');
const{getDb,closeDb}=require('./server/src/db');
const db=getDb();
const segs=JSON.parse(fs.readFileSync('/tmp/asr_ep${EP_ID}.json','utf8'));
// Group into 60s paragraphs
const groups=[];
if(segs.length){
  let ws=segs[0].start,wt=[];
  for(const s of segs){
    if(s.start-ws>=60&&wt.length){
      groups.push('['+Math.floor(ws/60)+':'+String(Math.floor(ws%60)).padStart(2,'0')+'] '+wt.join(''));
      ws=s.start;wt=[];
    }
    wt.push(s.text);
  }
  if(wt.length) groups.push('['+Math.floor(ws/60)+':'+String(Math.floor(ws%60)).padStart(2,'0')+'] '+wt.join(''));
}
const raw=groups.join('\n');
db.prepare(\"INSERT OR REPLACE INTO transcripts (episode_id,content,format,language,source) VALUES (?,?,'plain','zh','asr')\").run(${EP_ID},raw);
console.log('  Saved ASR: '+segs.length+' segments, '+raw.length+' chars');
closeDb();
" 2>/dev/null

  # Cleanup
  rm -f "/tmp/asr_ep${EP_ID}."* 2>/dev/null

  echo "  Done!"
done

echo ""
echo "=== All done! Now run: node scripts/fast-polish.js ==="
