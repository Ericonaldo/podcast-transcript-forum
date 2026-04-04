const { countInlineSpeakerTags, fixInlineSpeakerTags } = require('../scripts/lib/transcript-inline-speaker');

describe('inline speaker tag repair', () => {
  test('counts inline speaker tags inside a paragraph', () => {
    const content = '**[A]** Hello there. **[B]** Hi back.';
    expect(countInlineSpeakerTags(content)).toBe(1);
  });

  test('does not count speaker tags that already start paragraphs', () => {
    const content = '**[A]** Hello there.\n\n**[B]** Hi back.';
    expect(countInlineSpeakerTags(content)).toBe(0);
  });

  test('splits inline speaker tags into new paragraphs', () => {
    const content = '**[A]** Hello there. **[B]** Hi back. **[A]** Another turn.';
    expect(fixInlineSpeakerTags(content)).toBe('**[A]** Hello there.\n\n**[B]** Hi back.\n\n**[A]** Another turn.');
  });
});
