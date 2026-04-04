#!/usr/bin/env python3
"""
Batch transcription for YouTube-only episodes.
Downloads audio via yt-dlp, then transcribes with faster-whisper.
Always starts from ASR instead of YouTube captions so speaker-aware repair
can rely on a consistent source.
"""

import os
import sys
import json
import sqlite3
import tempfile
import subprocess
import time
import traceback
import re

# Ensure CUDA libraries are found
cuda_lib_paths = [
    os.path.expanduser("~/miniconda3/lib/python3.13/site-packages/nvidia/cublas/lib"),
    os.path.expanduser("~/miniconda3/lib/python3.13/site-packages/nvidia/cudnn/lib"),
]
existing_ld = os.environ.get('LD_LIBRARY_PATH', '')
extra_paths = ':'.join(p for p in cuda_lib_paths if os.path.isdir(p))
if extra_paths:
    os.environ['LD_LIBRARY_PATH'] = f"{extra_paths}:{existing_ld}" if existing_ld else extra_paths

DB_PATH = '/home/mhliu/podcast-transcript-forum/data/podcast.db'
TEMP_DIR = os.path.join(tempfile.gettempdir(), 'podcast_yt_transcribe')
os.makedirs(TEMP_DIR, exist_ok=True)


def get_youtube_episodes_without_transcripts(db_path):
    """Get episodes with YouTube URLs but no transcripts."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT e.id, e.title, e.episode_url, e.audio_url, e.podcast_id,
               p.name as podcast_name, p.language as podcast_language
        FROM episodes e
        JOIN podcasts p ON e.podcast_id = p.id
        WHERE e.id NOT IN (SELECT DISTINCT episode_id FROM transcripts)
        AND e.episode_url LIKE '%youtube.com%'
        ORDER BY p.name, e.published_date DESC
    """)
    episodes = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return episodes


def download_youtube_audio(video_url, output_path):
    """Download audio from YouTube using yt-dlp."""
    try:
        result = subprocess.run(
            ['yt-dlp', '-x', '--audio-format', 'mp3',
             '--audio-quality', '5',  # medium quality to save time
             '-o', output_path,
             video_url],
            capture_output=True, text=True, timeout=600
        )
        # yt-dlp may add extension
        actual_path = output_path
        if not os.path.exists(actual_path):
            actual_path = output_path + '.mp3'
        if not os.path.exists(actual_path):
            # Try to find the file
            base = os.path.splitext(output_path)[0]
            for ext in ['.mp3', '.m4a', '.opus', '.webm']:
                if os.path.exists(base + ext):
                    actual_path = base + ext
                    break

        if os.path.exists(actual_path):
            size = os.path.getsize(actual_path)
            return True, actual_path, f"Downloaded {size / 1024 / 1024:.1f} MB"
        return False, None, f"File not found after download. stderr: {result.stderr[:200]}"
    except subprocess.TimeoutExpired:
        return False, None, "Download timed out"
    except Exception as e:
        return False, None, str(e)


def convert_to_wav(input_path, output_path):
    """Convert audio to 16kHz mono WAV."""
    try:
        result = subprocess.run(
            ['ffmpeg', '-y', '-i', input_path, '-ar', '16000', '-ac', '1',
             '-c:a', 'pcm_s16le', output_path],
            capture_output=True, text=True, timeout=300
        )
        if result.returncode != 0:
            return False, f"ffmpeg failed: {result.stderr[:200]}"
        return True, "Converted"
    except Exception as e:
        return False, str(e)


def format_timestamp(seconds):
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{minutes:02d}:{secs:02d}"


def transcribe_audio(wav_path, language=None, model=None):
    """Transcribe audio using faster-whisper large-v3-turbo."""
    from faster_whisper import WhisperModel

    if model is None:
        print("  Loading whisper-large-v3-turbo model...")
        model = WhisperModel("large-v3-turbo", device="cuda", compute_type="int8_float16")

    lang = None
    if language and language.startswith('zh'):
        lang = 'zh'
    elif language == 'en':
        lang = 'en'

    segments, info = model.transcribe(
        wav_path,
        language=lang,
        beam_size=5,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500, speech_pad_ms=200),
        word_timestamps=False,
    )

    transcript_lines = []
    for segment in segments:
        start_time = format_timestamp(segment.start)
        text = segment.text.strip()
        if text:
            transcript_lines.append(f"[{start_time}] {text}")

    detected_language = info.language
    transcript_text = "\n".join(transcript_lines)
    return transcript_text, detected_language, model


def save_transcript(db_path, episode_id, content, language, source='asr', fmt='plain'):
    """Save transcript to database."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    lang_map = {'zh': 'zh', 'zh-Hans': 'zh-Hans', 'en': 'en', 'ja': 'ja', 'ko': 'ko', 'zh-TW': 'zh-TW'}
    db_language = lang_map.get(language, language or 'en')

    existing = cursor.execute(
        "SELECT id FROM transcripts WHERE episode_id = ? AND language = ?",
        (episode_id, db_language)
    ).fetchone()

    if existing:
        cursor.execute(
            "UPDATE transcripts SET content = ?, source = ?, format = ?, updated_at = datetime('now') WHERE id = ?",
            (content, source, fmt, existing[0])
        )
    else:
        cursor.execute(
            "INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, ?, ?, ?)",
            (episode_id, content, fmt, db_language, source)
        )

    conn.commit()
    conn.close()


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Batch transcribe YouTube episodes')
    parser.add_argument('--limit', type=int, default=0, help='Max episodes to process')
    parser.add_argument('--podcast', type=str, default='', help='Filter by podcast name')
    parser.add_argument('--db', type=str, default=DB_PATH, help='Database path')
    args = parser.parse_args()

    db_path = args.db
    print(f"Database: {db_path}")

    episodes = get_youtube_episodes_without_transcripts(db_path)
    print(f"Found {len(episodes)} YouTube episodes without transcripts")

    if args.podcast:
        episodes = [e for e in episodes if args.podcast.lower() in e['podcast_name'].lower()]
        print(f"Filtered to {len(episodes)} episodes matching '{args.podcast}'")

    if args.limit > 0:
        episodes = episodes[:args.limit]
        print(f"Limited to {args.limit} episodes")

    if not episodes:
        print("No episodes to process!")
        return

    success_count = 0
    fail_count = 0
    asr_count = 0
    failures = []
    model = None

    for i, episode in enumerate(episodes):
        ep_id = episode['id']
        title = episode['title']
        podcast = episode['podcast_name']
        video_url = episode['episode_url']
        language = episode.get('podcast_language', 'zh')

        print(f"\n{'='*60}")
        print(f"[{i+1}/{len(episodes)}] {podcast} - {title[:60]}")
        print(f"  URL: {video_url}")

        try:
            # Step 1: Download audio and transcribe with Whisper
            print("  Downloading audio for ASR...")
            audio_path = os.path.join(TEMP_DIR, f"yt_{ep_id}")
            wav_path = os.path.join(TEMP_DIR, f"yt_{ep_id}.wav")

            ok, actual_path, msg = download_youtube_audio(video_url, audio_path)
            if not ok:
                print(f"  FAILED to download: {msg}")
                failures.append({'id': ep_id, 'title': title, 'podcast': podcast, 'reason': f'YT download failed: {msg}'})
                fail_count += 1
                continue
            print(f"  {msg}")

            # Convert to WAV
            print("  Converting to WAV...")
            ok, msg = convert_to_wav(actual_path, wav_path)
            if not ok:
                print(f"  FAILED to convert: {msg}")
                failures.append({'id': ep_id, 'title': title, 'podcast': podcast, 'reason': f'Conversion failed: {msg}'})
                fail_count += 1
                continue

            # Load model if needed
            if model is None:
                from faster_whisper import WhisperModel
                print("  Loading whisper-large-v3-turbo model...")
                model = WhisperModel("large-v3-turbo", device="cuda", compute_type="int8_float16")

            # Transcribe
            print(f"  Transcribing (language hint: {language})...")
            start_time = time.time()
            transcript, detected_lang, model = transcribe_audio(wav_path, language, model)
            elapsed = time.time() - start_time

            if not transcript or len(transcript.strip()) < 10:
                print(f"  FAILED: Empty transcript")
                failures.append({'id': ep_id, 'title': title, 'podcast': podcast, 'reason': 'Empty transcript'})
                fail_count += 1
                continue

            print(f"  Transcribed in {elapsed:.1f}s, detected: {detected_lang}")
            print(f"  Length: {len(transcript)} chars")

            save_transcript(db_path, ep_id, transcript, detected_lang, source='asr')
            print(f"  Saved to database!")
            success_count += 1
            asr_count += 1

        except Exception as e:
            print(f"  ERROR: {e}")
            traceback.print_exc()
            failures.append({'id': ep_id, 'title': title, 'podcast': podcast, 'reason': str(e)})
            fail_count += 1
        finally:
            # Cleanup
            for pattern in [f"yt_{ep_id}*", f"caption*"]:
                import glob
                for f in glob.glob(os.path.join(TEMP_DIR, pattern)):
                    try:
                        os.remove(f)
                    except:
                        pass

    print(f"\n{'='*60}")
    print(f"YOUTUBE TRANSCRIPTION COMPLETE")
    print(f"  Success: {success_count} (ASR: {asr_count})")
    print(f"  Failed: {fail_count}")
    print(f"  Total: {len(episodes)}")

    if failures:
        print(f"\nFailed episodes:")
        for f in failures:
            print(f"  - [{f['podcast']}] {f['title'][:50]}: {f['reason'][:80]}")

        fail_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'yt_transcription_failures.json')
        with open(fail_path, 'w', encoding='utf-8') as fp:
            json.dump(failures, fp, ensure_ascii=False, indent=2)
        print(f"\nFailure details saved to: {fail_path}")


if __name__ == '__main__':
    main()
