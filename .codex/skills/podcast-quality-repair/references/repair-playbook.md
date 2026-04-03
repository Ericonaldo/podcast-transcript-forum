# Repair Playbook

## Batch order

1. Recover broken source transcripts.
2. Re-diarize or manually inspect speaker attribution on the hardest episodes.
3. Normalize speaker labels and tag format.
4. Remove duplicate `llm_translate` rows.
5. Re-run audit and spot-check.

## Acceptance criteria

- One canonical host label per episode.
- Guest labels use real names rather than `Guest` or `嘉宾`.
- No `**[Name:]**` or `**[Tag]**:` variants remain.
- English podcasts keep English in `llm_polish`.
- At most one final `llm_translate` row per episode.

## Commands

```bash
node scripts/audit-podcast-transcripts.js --podcast-id=<id>
node scripts/verify-speaker-tags.js
node scripts/check-ep.js <episodeId>
npm run postprocess -- --episode-id=<id>
```

## Repo shortcut for podcast 23

Use the targeted fixer when repairing Dwarkesh Podcast batches:

```bash
node scripts/repair-podcast-23.js --episodes=354,355,356,368
```
