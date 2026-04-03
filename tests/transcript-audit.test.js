const {
  auditEpisode,
  countColonTagForms,
  extractBracketedSpeakerCounts,
  prioritizeEpisode,
  summarizeSpeakerBuckets,
} = require('../scripts/lib/podcast-transcript-audit');

describe('podcast transcript audit helpers', () => {
  test('extracts bracketed speaker counts', () => {
    const counts = extractBracketedSpeakerCounts(
      '**[Dwarkesh]** Hello\n\n**[George Church]** Hi\n\n**[Dwarkesh]** Next question'
    );
    expect(counts).toEqual({
      Dwarkesh: 2,
      'George Church': 1,
    });
  });

  test('counts colon tag variants across formats', () => {
    const content = '**[Host:]** Hello\n**[Guest]**: Hi\n**Dwarkesh:** Next';
    expect(countColonTagForms(content)).toBe(3);
  });

  test('summarizes generic and host variants', () => {
    const summary = summarizeSpeakerBuckets(
      {
        Dwarkesh: 10,
        'Dwarkesh Patel': 5,
        Host: 20,
        Guest: 12,
        'George Church': 8,
      },
      'Dwarkesh Patel'
    );

    expect(summary.hostVariantCount).toBe(3);
    expect(summary.genericLabelCount).toBe(2);
    expect(summary.genericLabelHits).toBe(32);
    expect(summary.realNamedSpeakers).toBe(3);
  });

  test('audits source recovery and duplicate translation issues', () => {
    const audit = auditEpisode({
      episode: { id: 355, title: 'Ilya interview', published_date: '2025-11-25' },
      podcast: { host: 'Dwarkesh Patel', language: 'en' },
      transcripts: [
        { source: 'youtube_manual', language: 'zh', content: 'WEBVTT' },
        { source: 'llm_polish', language: 'zh', content: '**[主持人]** 你好\n\n**[嘉宾]** 你好' },
        { source: 'llm_translate', language: 'zh', content: '版本一' },
        { source: 'llm_translate', language: 'zh', content: '版本二' },
      ],
    });

    expect(audit.issues).toEqual(
      expect.arrayContaining([
        'Duplicate llm_translate rows: 2',
        'English podcast has Chinese polished transcript or Chinese generic speaker labels',
        'Source transcript is Chinese for an English podcast; recover English source before repolish',
        'Speaker attribution likely needs diarization/manual review',
      ])
    );
  });

  test('prioritizes source recovery above duplicate translations', () => {
    const sourceRecovery = { issues: ['Source transcript is Chinese for an English podcast; recover English source before repolish'] };
    const duplicateOnly = { issues: ['Duplicate llm_translate rows: 2'] };

    expect(prioritizeEpisode(sourceRecovery)).toBeLessThan(prioritizeEpisode(duplicateOnly));
  });
});
