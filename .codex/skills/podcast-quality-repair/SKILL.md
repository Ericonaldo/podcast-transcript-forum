---
name: podcast-quality-repair
description: Use when auditing or repairing a specific podcast with recurring transcript quality issues such as inconsistent speaker labels, generic guest names, language mismatches, duplicate translations, or episodes that need source recovery before repolish.
---

# Podcast Quality Repair

Use this skill when one podcast has repeated transcript problems across many episodes and you need a fast, repeatable fix plan.

## When to use

- One podcast has inconsistent host or guest labels across episodes.
- `llm_translate` rows are duplicated.
- An English podcast accidentally has Chinese `youtube_manual` or `llm_polish` transcripts.
- You need to decide which episodes only need normalization and which require source recovery or re-diarization.

## Workflow

1. Run the podcast audit:

```bash
node scripts/audit-podcast-transcripts.js --podcast-id=<id>
```

2. Bucket episodes by repair mode:

- Label normalization only
- Duplicate translation cleanup
- Recover source transcript first
- Re-diarize or manually review speaker attribution

3. Only after the audit, run the smallest safe fix:

- Tag cleanup and postprocess for formatting issues
- Re-polish only when the source transcript is valid
- Recover source transcript before any repolish if the source language is wrong

4. Re-run the audit after each batch until the issue counts drop to zero or to the remaining known hard cases.

## Repair heuristics

- Canonicalize the host to the podcast host's real full name.
- Replace `Guest` or `嘉宾` with the real guest name only when metadata makes the mapping unambiguous.
- Treat `Host`, `Speaker 1`, `主持人`, and `嘉宾` as red flags, not finished output.
- For English podcasts, `llm_polish` should stay English. Chinese belongs in `llm_translate`.
- If generic labels dominate and real names are absent, assume diarization or mapping may be wrong.

Read [references/repair-playbook.md](references/repair-playbook.md) for the batch order and acceptance criteria.
