# Transcript Commands

## Canonical npm scripts

- `npm run update`
- `npm run asr`
- `npm run polish`
- `npm run postprocess`

## Common flows

### Pull latest episodes

```bash
npm run update
npm run update -- --podcast-id=16 --limit=20
```

### New episode ASR + diarization

```bash
npm run asr -- --episode-id=166
npm run asr -- --podcast-id=16
npm run asr -- --podcast-id=17 --no-polish
npm run asr -- --episode-id=166 --reprocess
```

### Re-polish existing diarized transcripts

```bash
node scripts/repolish-ep.js --episode-id=96
node scripts/repolish-ep.js --podcast-id=16
node scripts/repolish-ep.js --all-zh
node scripts/repolish-ep.js --all-zh --skip=96,100
```

### Postprocess and QA

```bash
npm run postprocess -- --episode-id=96
node scripts/verify-speaker-tags.js
node scripts/check-ep.js 96
node scripts/scan-wrong-content.js
```

## Script notes

- `scripts/update-podcasts.js` pulls new episodes from RSS and channel sources into SQLite.
- `scripts/repolish-ep.js` assumes `asr_diarized` already exists and preserves speaker switches.
- `scripts/postprocess-polish.js` removes prompt leakage, normalizes speaker tags, and merges same-speaker paragraphs.
- `scripts/verify-speaker-tags.js` is the fastest repo-native smoke test for malformed tag shapes.
