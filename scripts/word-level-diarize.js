#!/usr/bin/env node
const Database = require('better-sqlite3');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const db = new Database('data/podcast.db');

async function wordLevelDiarize(episodeId) {
  const ep = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId);
  if (!ep) throw new Error(`Episode ${episodeId} not found`);

  console.log(`[ep${ep.id}] ${ep.title}`);

  // Download audio
  const audioFile = `audio_${ep.id}.mp3`;
  console.log(`Downloading audio...`);
  await downloadAudio(ep.audio_url || ep.episode_url, audioFile);

  // Run WhisperX with word-level alignment
  console.log(`Running WhisperX transcribe + align...`);
  const whisperxFile = `whisperx_${ep.id}.json`;
  await runWhisperX(audioFile, whisperxFile);

  // Run pyannote diarization
  console.log(`Running pyannote diarization...`);
  const diarizeFile = `diarize_${ep.id}.json`;
  await runPyannote(audioFile, diarizeFile);

  // Merge word-level
  console.log(`Merging word-level...`);
  const whisperx = JSON.parse(fs.readFileSync(whisperxFile, 'utf8'));
  const diarize = JSON.parse(fs.readFileSync(diarizeFile, 'utf8'));

  const merged = mergeWordLevel(whisperx, diarize);

  // Save to DB
  db.prepare(`INSERT INTO transcripts (episode_id, content, source, language)
              VALUES (?, ?, 'asr_word_diarized', 'en')
              ON CONFLICT(episode_id, source) DO UPDATE SET content=excluded.content, updated_at=CURRENT_TIMESTAMP`)
    .run(ep.id, merged);

  console.log(`Saved ${merged.length} chars`);

  // Cleanup
  [audioFile, whisperxFile, diarizeFile].forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
}

function mergeWordLevel(whisperx, diarize) {
  const lines = [];
  let currentSpeaker = null;
  let currentText = [];
  let currentStart = null;

  for (const seg of whisperx.segments) {
    for (const word of seg.words || []) {
      const wordStart = word.start;
      const wordEnd = word.end;
      const wordText = word.word;

      // Find speaker at this timestamp
      const speaker = findSpeakerAt(diarize, (wordStart + wordEnd) / 2);

      if (speaker !== currentSpeaker) {
        // Speaker changed - flush current line
        if (currentText.length > 0) {
          lines.push(`[${formatTime(currentStart)}] [${currentSpeaker}] ${currentText.join('')}`);
        }
        currentSpeaker = speaker;
        currentText = [wordText];
        currentStart = wordStart;
      } else {
        currentText.push(wordText);
      }
    }
  }

  // Flush last line
  if (currentText.length > 0) {
    lines.push(`[${formatTime(currentStart)}] [${currentSpeaker}] ${currentText.join('')}`);
  }

  return lines.join('\n');
}

function findSpeakerAt(diarize, timestamp) {
  for (const turn of diarize) {
    if (timestamp >= turn.start && timestamp <= turn.end) {
      return turn.speaker;
    }
  }
  return 'UNKNOWN';
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function downloadAudio(url, outFile) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', ['-x', '--audio-format', 'mp3', '-o', outFile, url]);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`Download failed: ${code}`)));
  });
}

async function runWhisperX(audioFile, outFile) {
  return new Promise((resolve, reject) => {
    const proc = spawn('whisperx', [audioFile, '--model', 'large-v2', '--align_model', 'WAV2VEC2_ASR_LARGE_LV60K_960H', '--output_format', 'json', '--output_dir', '.']);
    proc.on('close', code => {
      if (code === 0) {
        fs.renameSync(audioFile.replace('.mp3', '.json'), outFile);
        resolve();
      } else {
        reject(new Error(`WhisperX failed: ${code}`));
      }
    });
  });
}

async function runPyannote(audioFile, outFile) {
  const script = `
import json
from pyannote.audio import Pipeline
pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token="${process.env.HF_TOKEN}")
diarization = pipeline("${audioFile}")
turns = [{"start": turn.start, "end": turn.end, "speaker": speaker} for turn, _, speaker in diarization.itertracks(yield_label=True)]
with open("${outFile}", "w") as f:
    json.dump(turns, f)
`;

  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-c', script]);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`Pyannote failed: ${code}`)));
  });
}

const episodeId = process.argv[2] || 96;
wordLevelDiarize(episodeId).catch(console.error);
