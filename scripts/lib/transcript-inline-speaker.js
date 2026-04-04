const TAG_RE = /\*\*\[[^\]]+\]\*\*/g;
const TIMESTAMP_TAG_RE = /^\[\d{1,3}:\d{2}(?::\d{2})?\]\s+\*\*\[[^\]]+\]\*\*/;

function countInlineSpeakerTags(content) {
  let count = 0;

  for (const line of content.split('\n')) {
    const tags = line.match(TAG_RE) || [];
    if (!tags.length) continue;

    const trimmed = line.trimStart();
    if (!trimmed.startsWith(tags[0]) && !TIMESTAMP_TAG_RE.test(trimmed)) {
      count += 1;
    }

    if (tags.length > 1) {
      count += tags.length - 1;
    }
  }

  return count;
}

function fixInlineSpeakerTags(content) {
  const fixedLines = content.split('\n').flatMap((line) => {
    let working = line.replace(/\*\*\[[^\]]+\]\*\*[ \t]+\*\*\[([^\]]+)\]\*\*/g, '**[$1]**');
    const trimmed = working.trimStart();

    if (!working.includes('**[')) {
      return [working];
    }

    if (trimmed.startsWith('**[') || TIMESTAMP_TAG_RE.test(trimmed)) {
      const pieces = working.split(/(?=\*\*\[[^\]]+\]\*\*)/g);
      if (pieces.length === 1) return [working];

      const output = [];
      let first = true;
      for (const piece of pieces) {
        if (!piece.trim()) continue;
        if (first) {
          output.push(piece.trimEnd());
          first = false;
        } else {
          output.push('');
          output.push(piece.trim());
        }
      }
      return output;
    }

    working = working.replace(/([^\n])([ \t]+)(\*\*\[[^\]]+\]\*\*)/g, '$1\n\n$3');
    return working.split('\n');
  });

  return fixedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = {
  countInlineSpeakerTags,
  fixInlineSpeakerTags,
};
