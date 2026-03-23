#!/usr/bin/env python3
"""
Fix fragmented transcripts for 声东击西 podcast episodes.
- Merge consecutive same-speaker short fragments into paragraphs
- Fix incorrect/inconsistent speaker names
- Normalize speaker tag format
"""

import json
import re
import sys
import urllib.request

BASE_URL = "http://192.3.168.14:4010/api"

# Speaker name corrections per episode
# Based on episode descriptions with confirmed guest names
SPEAKER_FIXES = {
    505: {
        '赞涛': '昝涛',
        '刘明': '昝涛',
        '主持人': '徐涛',
        '嘉宾A': '昝涛',
    },
    506: {
        '真名': '雅贤',  # Yaxian from 科技早知道
    },
    507: {
        '讲述人': '孙谦',  # media person based in Berlin
    },
    509: {
        '真名': '董晨宇',  # 中国人民大学新闻学院副教授
        '董老师': '董晨宇',
        '董成瑜': '董晨宇',
        '徐黎': '许磊',
        '徐磊': '许磊',
        '徐总': '许磊',
    },
    510: {
        '真名': 'Sofia',
        'Sophia': 'Sofia',
        'Sophie': 'Sofia',
    },
    511: {
        '苏菲亚': 'Sophia',
        '索菲亚': 'Sophia',
        'Sofia': 'Sophia',
    },
    512: {
        '达威': '达巍',
    },
    513: {
        '可轩': '可宣',
    },
    514: {
        '真名': '骞文',
        '孟一': '孟岩',
        '千文': '骞文',
    },
    517: {
        '主持人': '徐涛',
        '真名': 'Aaron',
        '听众': 'Aaron',
    },
    518: {
        '主持人': '徐涛',
        '徐桃': '陈燚',
    },
    519: {
        '真名': '东东枪',
        '东东腔': '东东枪',
        '东东腋': '东东枪',
        '东方枪': '东东枪',
    },
    520: {
        '主持人': '徐涛',
        '宋瑞华': '宋睿华',
        '宋老师': '宋睿华',
    },
    521: {
        '真名': 'Diane',
        '真名1': 'Yaxian',
        '真名2': 'Babs',
    },
    522: {
        '赵英': '冯兆音',
    },
    523: {
        '主持人': '徐涛',
        '主持er': '徐涛',
    },
    524: {
        '王先生': '可宣',
    },
}


def fetch_transcript(episode_id):
    """Fetch transcript from API."""
    url = f"{BASE_URL}/episodes/{episode_id}/transcript"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))


def save_transcript(episode_id, content, fmt='plain', source='llm_polish', language='zh'):
    """Save fixed transcript via API."""
    url = f"{BASE_URL}/episodes/{episode_id}/transcript"
    data = json.dumps({
        'content': content,
        'format': fmt,
        'language': language,
        'source': source,
        'replace': True,
    }).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))


def parse_line(line):
    """Parse a transcript line into components: timestamp, speaker, text."""
    line = line.strip()
    if not line:
        return None, None, ''

    timestamp = None
    speaker = None
    text = line

    # Extract timestamp [MM:SS] or [HH:MM:SS] at the start
    ts_match = re.match(r'^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*', text)
    if ts_match:
        timestamp = ts_match.group(1)
        text = text[ts_match.end():]

    # Extract speaker tag: **[Name]** or **[Name]**: or **Name**: or **Name**:
    # Pattern 1: **[Name]**:? or **[Name]**
    sp_match = re.match(r'\*\*\[([^\]]+)\]\*\*:?\s*', text)
    if sp_match:
        speaker = sp_match.group(1).strip()
        text = text[sp_match.end():]
    else:
        # Pattern 2: **Name**:
        sp_match = re.match(r'\*\*([^*]+)\*\*:\s*', text)
        if sp_match:
            speaker = sp_match.group(1).strip()
            text = text[sp_match.end():]

    # Check if "speaker" is actually a timestamp (e.g., **[11:25]**)
    if speaker and re.match(r'^\d{1,2}:\d{2}(:\d{2})?$', speaker):
        # This is a timestamp mistakenly parsed as speaker
        if not timestamp:
            timestamp = speaker
        speaker = None

    # Also check for timestamp at start of text without brackets (sometimes after speaker)
    if not timestamp:
        ts_match2 = re.match(r'^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*', text)
        if ts_match2:
            timestamp = ts_match2.group(1)
            text = text[ts_match2.end():]

    return timestamp, speaker, text.strip()


def fix_speaker_name(speaker, fixes):
    """Apply speaker name corrections."""
    if speaker and speaker in fixes:
        return fixes[speaker]
    return speaker


def is_timestamp_speaker(name):
    """Check if a name is actually a timestamp."""
    return bool(re.match(r'^\d{1,2}:\d{2}(:\d{2})?$', name or ''))


def merge_transcript(content, speaker_fixes=None):
    """Merge fragmented transcript lines into proper paragraphs."""
    if not speaker_fixes:
        speaker_fixes = {}

    lines = content.split('\n')

    # Parse all lines
    parsed = []
    for line in lines:
        ts, speaker, text = parse_line(line)
        if speaker:
            speaker = fix_speaker_name(speaker, speaker_fixes)
        if text or speaker:  # Skip completely empty lines (unless they separate sections)
            parsed.append({
                'timestamp': ts,
                'speaker': speaker,
                'text': text,
            })

    # Group consecutive same-speaker entries
    groups = []
    current_group = None

    for entry in parsed:
        speaker = entry['speaker']
        text = entry['text']
        ts = entry['timestamp']

        if not text and not speaker:
            continue

        # Determine effective speaker (carry forward from previous if none specified)
        if speaker is None and current_group:
            effective_speaker = current_group['speaker']
        else:
            effective_speaker = speaker

        # Should we start a new group?
        start_new = False
        if current_group is None:
            start_new = True
        elif effective_speaker != current_group['speaker']:
            start_new = True
        elif speaker is not None and speaker == current_group['speaker']:
            # Same speaker explicitly tagged again - check if text is substantial
            # If current group is already long enough (~200 chars), maybe start new paragraph
            current_text_len = len(current_group['text'])
            if current_text_len > 300:
                start_new = True

        if start_new:
            if current_group and current_group['text']:
                groups.append(current_group)
            current_group = {
                'timestamp': ts,
                'speaker': effective_speaker,
                'text': text,
            }
        else:
            # Merge into current group
            if text:
                # Clean up: remove trailing incomplete punctuation connectors
                current_text = current_group['text']
                # If current ends with Chinese comma or no punctuation, merge smoothly
                if current_text and not current_text[-1] in '。！？…"』】)）':
                    # Remove trailing spaces and merge
                    current_group['text'] = current_text.rstrip() + text
                else:
                    current_group['text'] = current_text.rstrip() + text

    # Don't forget the last group
    if current_group and current_group['text']:
        groups.append(current_group)

    # Also fix name references in text body
    text_fixes = {}
    for old_name, new_name in speaker_fixes.items():
        if old_name != new_name:
            text_fixes[old_name] = new_name

    # Format output
    output_lines = []
    for group in groups:
        ts = group['timestamp']
        speaker = group['speaker']
        text = group['text']

        # Clean up text
        text = text.strip()
        text = re.sub(r'\s+', ' ', text)  # collapse multiple spaces
        # Remove trailing "  " (double space used as line break in markdown)
        text = text.rstrip()

        # Fix name references in text body (e.g., "赞涛" → "昝涛" in text)
        for old_name, new_name in text_fixes.items():
            # Only fix if it's clearly a name reference, not a common word
            if len(old_name) >= 2:
                text = text.replace(old_name, new_name)

        if not text:
            continue

        parts = []
        if ts:
            parts.append(f'[{ts}]')
        if speaker:
            parts.append(f'**[{speaker}]**')
        parts.append(text)

        line = ' '.join(parts)
        output_lines.append(line)
        output_lines.append('')  # blank line between paragraphs

    return '\n'.join(output_lines).strip() + '\n'


def process_episode(episode_id, dry_run=False):
    """Process a single episode."""
    print(f"\n{'='*60}")
    print(f"Processing Episode {episode_id}")
    print(f"{'='*60}")

    try:
        data = fetch_transcript(episode_id)
    except Exception as e:
        print(f"  ERROR fetching transcript: {e}")
        return False

    content = data.get('content', '')
    if not content:
        print(f"  No transcript content found")
        return False

    fmt = data.get('format', 'plain')
    source = data.get('source', 'llm_polish')
    language = data.get('language', 'zh')

    lines_before = len([l for l in content.split('\n') if l.strip()])
    fixes = SPEAKER_FIXES.get(episode_id, {})

    # Count speaker occurrences before
    speakers_before = {}
    for m in re.finditer(r'\*\*\[([^\]]+)\]\*\*|\*\*([^*]+)\*\*:', content):
        name = (m.group(1) or m.group(2)).strip()
        speakers_before[name] = speakers_before.get(name, 0) + 1

    # Fix the transcript
    fixed = merge_transcript(content, fixes)

    lines_after = len([l for l in fixed.split('\n') if l.strip()])

    # Count speakers after
    speakers_after = {}
    for m in re.finditer(r'\*\*\[([^\]]+)\]\*\*', fixed):
        name = m.group(1).strip()
        speakers_after[name] = speakers_after.get(name, 0) + 1

    print(f"  Lines: {lines_before} → {lines_after}")
    print(f"  Speaker fixes applied: {fixes if fixes else 'none'}")
    print(f"  Speakers before: {speakers_before}")
    print(f"  Speakers after:  {speakers_after}")

    if dry_run:
        # Show sample
        sample_lines = fixed.split('\n')[:20]
        print(f"\n  --- Sample output (first 20 lines) ---")
        for line in sample_lines:
            print(f"  {line}")
        return True

    # Save
    try:
        result = save_transcript(episode_id, fixed, fmt, source, language)
        print(f"  ✓ Saved successfully (transcript id: {result.get('id')})")
        return True
    except Exception as e:
        print(f"  ERROR saving: {e}")
        return False


def main():
    # All 声东击西 episode IDs
    episode_ids = [505, 506, 507, 508, 509, 510, 511, 512, 513, 514,
                   515, 516, 517, 518, 519, 520, 521, 522, 523, 524]

    dry_run = '--dry-run' in sys.argv

    # If specific episode IDs provided
    specific = [int(x) for x in sys.argv[1:] if x.isdigit()]
    if specific:
        episode_ids = specific

    if dry_run:
        print("DRY RUN MODE - no changes will be saved")

    success = 0
    failed = 0
    for eid in episode_ids:
        if process_episode(eid, dry_run=dry_run):
            success += 1
        else:
            failed += 1

    print(f"\n{'='*60}")
    print(f"Done: {success} succeeded, {failed} failed")


if __name__ == '__main__':
    main()
