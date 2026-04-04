---
name: podcast-transcript-pipeline
description: >-
  Use when working on this repo's transcript ingestion and repair workflow:
  fetching latest podcast episodes, running ASR plus diarization,
  re-polishing existing transcripts, postprocessing speaker tags, or auditing
  transcript quality issues such as wrong speaker splits, malformed tags, and
  bad paragraphing.
---

# Podcast Transcript Pipeline

Use this skill for repo-specific transcript operations in `podcast-transcript-forum`.

## When to use

- The user asks to pull latest episodes into the DB.
- The task is to run ASR or diarization for new episodes.
- The task is to re-polish existing transcripts without retranscribing.
- The task is to clean malformed speaker tags or paragraph structure.
- The task is to inspect transcript quality issues before or after edits.

## Command routing

- Update feed inventory: `npm run update -- --podcast-id=<id> --limit=<n>`
- New episode ASR + diarization: `npm run asr -- --episode-id=<id>`
- Podcast-wide ASR: `npm run asr -- --podcast-id=<id>`
- Re-polish diarized transcript: `node scripts/repolish-ep.js --episode-id=<id>`
- Re-polish all Chinese diarized transcripts: `node scripts/repolish-ep.js --all-zh`
- Re-polish one podcast: `node scripts/repolish-ep.js --podcast-id=<id>`
- Postprocess polished output: `npm run postprocess -- --episode-id=<id>`
- Audit malformed speaker tags: `node scripts/verify-speaker-tags.js`
- Audit inline speaker tags: `npm run audit:inline-speakers`
- Fix inline speaker tags: `npm run fix:inline-speakers`
- Inspect one episode's polished transcript: `node scripts/check-ep.js <episodeId>`

Read [references/commands.md](references/commands.md) for the fuller command set and script-specific notes.

## Guardrails

- Re-polish must preserve the original transcript text and order. Do not retranscribe when the task is repolish-only.
- Speaker naming should use episode metadata and description to avoid homophone mistakes.
- After polishing, always run postprocess cleanup so leaked prompt hints and malformed tag variants are removed.
- When a speaker tag appears mid-paragraph, use the inline-speaker repair script instead of hand-editing transcript rows.
- Do not merge across speaker boundaries. Same-speaker consecutive lines can be merged into one paragraph.
- Prefer Bilibili over YouTube over 小宇宙 over other sources when choosing media links.

## Working pattern

1. Identify the source state first: `asr`, `asr_diarized`, `llm_polish`, or missing transcript.
2. Choose the minimum pipeline step that fixes the issue.
3. Run the relevant repo script, not an ad hoc rewrite.
4. Postprocess if polished content changed.
5. If paragraph boundaries still look wrong because a new speaker starts mid-line, run the inline-speaker fixer.
6. Run a QA pass using the audit scripts or direct DB inspection.

## QA checklist

- Speaker tags are normalized to `**[Name]**`.
- No prompt leakage remains, including `Part X/Y` or `Use these exact names`.
- Same-speaker short fragments are merged into readable paragraphs.
- Different speakers never share the same paragraph line.
- Timestamps remain only where they belong.
- Any claimed fix is validated by script output or a focused content inspection.
