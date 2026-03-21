#!/usr/bin/env python3
"""
Batch transcription script using faster-whisper large-v3-turbo.
Downloads audio from episodes without transcripts and transcribes them.
"""

import os
import sys
import json
import sqlite3
import tempfile
import subprocess
import time
import traceback
from pathlib import Path

# Ensure CUDA libraries are found
cuda_lib_paths = [
    os.path.expanduser("~/miniconda3/lib/python3.13/site-packages/nvidia/cublas/lib"),
    os.path.expanduser("~/miniconda3/lib/python3.13/site-packages/nvidia/cudnn/lib"),
]
existing_ld = os.environ.get('LD_LIBRARY_PATH', '')
extra_paths = ':'.join(p for p in cuda_lib_paths if os.path.isdir(p))
if extra_paths:
    os.environ['LD_LIBRARY_PATH'] = f"{extra_paths}:{existing_ld}" if existing_ld else extra_paths

# Use the main repo's database
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'podcast.db')

# Check if the main repo DB exists, fall back to worktree
if not os.path.exists(DB_PATH):
    DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'podcast.db')

TEMP_DIR = os.path.join(tempfile.gettempdir(), 'podcast_transcribe')
os.makedirs(TEMP_DIR, exist_ok=True)

# Max audio duration to process (in seconds) - skip very long episodes
MAX_DURATION_SECONDS = 7200  # 2 hours

# Download timeout
DOWNLOAD_TIMEOUT = 300  # 5 minutes

def get_episodes_without_transcripts(db_path):
    """Get all episodes that have audio URLs but no transcripts."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT e.id, e.title, e.audio_url, e.duration, e.podcast_id,
               p.name as podcast_name, p.language as podcast_language
        FROM episodes e
        JOIN podcasts p ON e.podcast_id = p.id
        WHERE e.id NOT IN (SELECT DISTINCT episode_id FROM transcripts)
        AND e.audio_url IS NOT NULL
        AND length(e.audio_url) > 0
        ORDER BY p.name, e.published_date DESC
    """)
    episodes = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return episodes


def download_audio(url, output_path):
    """Download audio file from URL using curl with redirect following."""
    try:
        # Fix HTML entities in URLs
        clean_url = url.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
        result = subprocess.run(
            ['curl', '-L', '-o', output_path, '-s', '--max-time', str(DOWNLOAD_TIMEOUT),
             '--retry', '2', '--retry-delay', '5',
             '-H', 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
             clean_url],
            capture_output=True, text=True, timeout=DOWNLOAD_TIMEOUT + 30
        )
        if result.returncode != 0:
            return False, f"curl failed: {result.stderr}"

        # Check file size
        if os.path.exists(output_path):
            size = os.path.getsize(output_path)
            if size < 1000:  # Less than 1KB is likely an error
                # Read the content to check if it's an error page
                with open(output_path, 'rb') as f:
                    content = f.read(500)
                os.remove(output_path)
                return False, f"Downloaded file too small ({size} bytes), likely error: {content[:200]}"
            return True, f"Downloaded {size / 1024 / 1024:.1f} MB"
        return False, "File not created"
    except subprocess.TimeoutExpired:
        return False, "Download timed out"
    except Exception as e:
        return False, str(e)


def convert_to_wav(input_path, output_path):
    """Convert audio to 16kHz mono WAV for whisper processing."""
    try:
        result = subprocess.run(
            ['ffmpeg', '-y', '-i', input_path, '-ar', '16000', '-ac', '1',
             '-c:a', 'pcm_s16le', output_path],
            capture_output=True, timeout=300
        )
        if result.returncode != 0:
            stderr_text = result.stderr.decode('utf-8', errors='replace')[:200]
            return False, f"ffmpeg failed: {stderr_text}"
        return True, "Converted"
    except Exception as e:
        return False, str(e)


def transcribe_audio(wav_path, language=None, model=None):
    """Transcribe audio using faster-whisper large-v3-turbo."""
    from faster_whisper import WhisperModel

    if model is None:
        # Load model on first call
        print("  Loading whisper-large-v3-turbo model...")
        model = WhisperModel("large-v3-turbo", device="cuda", compute_type="int8_float16")

    # Detect language or use provided
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
        vad_parameters=dict(
            min_silence_duration_ms=500,
            speech_pad_ms=200,
        ),
        word_timestamps=False,
    )

    # Collect segments with timestamps
    transcript_lines = []
    full_text_parts = []
    for segment in segments:
        start_time = format_timestamp(segment.start)
        end_time = format_timestamp(segment.end)
        text = segment.text.strip()
        if text:
            transcript_lines.append(f"[{start_time}] {text}")
            full_text_parts.append(text)

    detected_language = info.language
    transcript_text = "\n".join(transcript_lines)

    return transcript_text, detected_language, model


def format_timestamp(seconds):
    """Format seconds to MM:SS."""
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{minutes:02d}:{secs:02d}"


def save_transcript(db_path, episode_id, content, language, source='asr'):
    """Save transcript to the database."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Map language codes
    lang_map = {'zh': 'zh', 'en': 'en', 'ja': 'ja', 'ko': 'ko'}
    db_language = lang_map.get(language, language or 'en')

    # Check if transcript already exists for this episode + language
    existing = cursor.execute(
        "SELECT id FROM transcripts WHERE episode_id = ? AND language = ?",
        (episode_id, db_language)
    ).fetchone()

    if existing:
        cursor.execute(
            "UPDATE transcripts SET content = ?, source = ?, updated_at = datetime('now') WHERE id = ?",
            (content, source, existing[0])
        )
    else:
        cursor.execute(
            "INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, ?, ?, ?)",
            (episode_id, content, 'plain', db_language, source)
        )

    conn.commit()
    conn.close()


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Batch transcribe podcast episodes')
    parser.add_argument('--limit', type=int, default=0, help='Max episodes to process (0=all)')
    parser.add_argument('--podcast', type=str, default='', help='Filter by podcast name (partial match)')
    parser.add_argument('--skip-download-errors', action='store_true', help='Continue on download errors')
    parser.add_argument('--db', type=str, default=DB_PATH, help='Database path')
    args = parser.parse_args()

    db_path = args.db
    print(f"Database: {db_path}")
    print(f"Temp directory: {TEMP_DIR}")

    episodes = get_episodes_without_transcripts(db_path)
    print(f"Found {len(episodes)} episodes without transcripts")

    if args.podcast:
        episodes = [e for e in episodes if args.podcast.lower() in e['podcast_name'].lower()]
        print(f"Filtered to {len(episodes)} episodes matching '{args.podcast}'")

    if args.limit > 0:
        episodes = episodes[:args.limit]
        print(f"Limited to {args.limit} episodes")

    if not episodes:
        print("No episodes to process!")
        return

    # Stats
    success_count = 0
    fail_count = 0
    skip_count = 0
    failures = []

    # Load model once
    from faster_whisper import WhisperModel
    print("Loading whisper-large-v3-turbo model (this may take a moment)...")
    model = WhisperModel("large-v3-turbo", device="cuda", compute_type="int8_float16")
    print("Model loaded!")

    for i, episode in enumerate(episodes):
        ep_id = episode['id']
        title = episode['title']
        podcast = episode['podcast_name']
        audio_url = episode['audio_url']
        language = episode.get('podcast_language', 'en')

        print(f"\n{'='*60}")
        print(f"[{i+1}/{len(episodes)}] {podcast} - {title[:60]}")
        print(f"  Audio: {audio_url[:80]}...")

        # Create temp files
        mp3_path = os.path.join(TEMP_DIR, f"ep_{ep_id}.mp3")
        wav_path = os.path.join(TEMP_DIR, f"ep_{ep_id}.wav")

        try:
            # Step 1: Download
            print("  Downloading audio...")
            ok, msg = download_audio(audio_url, mp3_path)
            if not ok:
                print(f"  FAILED to download: {msg}")
                failures.append({'id': ep_id, 'title': title, 'podcast': podcast, 'reason': f'Download failed: {msg}'})
                fail_count += 1
                continue
            print(f"  {msg}")

            # Step 2: Convert to WAV
            print("  Converting to WAV...")
            ok, msg = convert_to_wav(mp3_path, wav_path)
            if not ok:
                print(f"  FAILED to convert: {msg}")
                failures.append({'id': ep_id, 'title': title, 'podcast': podcast, 'reason': f'Conversion failed: {msg}'})
                fail_count += 1
                continue

            # Step 3: Transcribe
            print(f"  Transcribing (language hint: {language})...")
            start_time = time.time()
            transcript, detected_lang, model = transcribe_audio(wav_path, language, model)
            elapsed = time.time() - start_time

            if not transcript or len(transcript.strip()) < 10:
                print(f"  FAILED: Empty or very short transcript")
                failures.append({'id': ep_id, 'title': title, 'podcast': podcast, 'reason': 'Empty transcript'})
                fail_count += 1
                continue

            print(f"  Transcribed in {elapsed:.1f}s, detected language: {detected_lang}")
            print(f"  Transcript length: {len(transcript)} chars, ~{len(transcript.split(chr(10)))} lines")

            # Step 4: Save to database
            save_transcript(db_path, ep_id, transcript, detected_lang, source='asr')
            print(f"  Saved to database!")
            success_count += 1

        except Exception as e:
            print(f"  ERROR: {e}")
            traceback.print_exc()
            failures.append({'id': ep_id, 'title': title, 'podcast': podcast, 'reason': str(e)})
            fail_count += 1
        finally:
            # Cleanup temp files
            for f in [mp3_path, wav_path]:
                if os.path.exists(f):
                    try:
                        os.remove(f)
                    except:
                        pass

    # Summary
    print(f"\n{'='*60}")
    print(f"TRANSCRIPTION COMPLETE")
    print(f"  Success: {success_count}")
    print(f"  Failed: {fail_count}")
    print(f"  Skipped: {skip_count}")
    print(f"  Total: {len(episodes)}")

    if failures:
        print(f"\nFailed episodes:")
        for f in failures:
            print(f"  - [{f['podcast']}] {f['title'][:50]}: {f['reason'][:80]}")

        # Save failures to a JSON file
        fail_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'transcription_failures.json')
        with open(fail_path, 'w', encoding='utf-8') as fp:
            json.dump(failures, fp, ensure_ascii=False, indent=2)
        print(f"\nFailure details saved to: {fail_path}")


if __name__ == '__main__':
    main()
