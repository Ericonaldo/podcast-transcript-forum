const GENERIC_SPEAKER_RE = /^(host|guest|speaker\s*\d+|speaker|主持人|嘉宾|主讲人|unknown|未知说话人|未知)$/i;

function extractBracketedSpeakerCounts(content) {
  const counts = new Map();
  const re = /\*\*\[([^\]]+)\]\*\*/g;
  let match;

  while ((match = re.exec(content)) !== null) {
    const raw = match[1].trim();
    counts.set(raw, (counts.get(raw) || 0) + 1);
  }

  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

function countColonTagForms(content) {
  const bracketColon = (content.match(/\*\*\[[^\]]+[：:]\]\*\*/g) || []).length;
  const colonAfterTag = (content.match(/\*\*\[[^\]]+\]\*\*[：:]/g) || []).length;
  const bareColonTag = (content.match(/\*\*[^*\n]{1,50}[：:]\*\*/g) || []).length;
  return bracketColon + colonAfterTag + bareColonTag;
}

function summarizeSpeakerBuckets(counts, hostName = '') {
  const hostNeedles = new Set(
    [hostName, ...hostName.split(/\s+/)].map(v => v && v.toLowerCase()).filter(Boolean)
  );

  let hostVariantCount = 0;
  let genericLabelCount = 0;
  let genericLabelHits = 0;
  let realNamedSpeakers = 0;

  for (const [speaker, count] of Object.entries(counts)) {
    const normalized = speaker.replace(/[：:]+$/, '').trim();
    const lower = normalized.toLowerCase();
    const isGeneric = GENERIC_SPEAKER_RE.test(normalized);
    const looksLikeHost =
      ['host', '主持人'].includes(lower) ||
      lower === hostName.toLowerCase() ||
      [...hostNeedles].some(needle => needle && lower.includes(needle));

    if (looksLikeHost || ['dwarkesh', 'dwarkesh patel'].includes(lower)) {
      hostVariantCount += 1;
    }

    if (isGeneric) {
      genericLabelCount += 1;
      genericLabelHits += count;
    } else {
      realNamedSpeakers += 1;
    }
  }

  return {
    hostVariantCount,
    genericLabelCount,
    genericLabelHits,
    realNamedSpeakers,
  };
}

function detectLanguageMismatch({ podcastLanguage, transcriptLanguage, source, speakerCounts }) {
  if (source !== 'llm_polish') return null;
  if (!podcastLanguage || !transcriptLanguage) return null;

  const podcastIsEnglish = podcastLanguage.toLowerCase().startsWith('en');
  const transcriptIsChinese = transcriptLanguage.toLowerCase().startsWith('zh');
  const hasChineseGenericLabels = ['主持人', '嘉宾', '未知说话人', '主讲人'].some(label => speakerCounts[label]);

  if (podcastIsEnglish && (transcriptIsChinese || hasChineseGenericLabels)) {
    return 'English podcast has Chinese polished transcript or Chinese generic speaker labels';
  }

  return null;
}

function auditEpisode({ episode, transcripts, podcast }) {
  const grouped = transcripts.reduce((acc, transcript) => {
    acc[transcript.source] ||= [];
    acc[transcript.source].push(transcript);
    return acc;
  }, {});

  const llmPolish = grouped.llm_polish?.[0] || null;
  const translateCount = grouped.llm_translate?.length || 0;
  const polishSpeakerCounts = llmPolish ? extractBracketedSpeakerCounts(llmPolish.content) : {};
  const polishBuckets = summarizeSpeakerBuckets(polishSpeakerCounts, podcast.host || '');
  const colonTagForms = llmPolish ? countColonTagForms(llmPolish.content) : 0;

  const issues = [];
  if (translateCount > 1) {
    issues.push(`Duplicate llm_translate rows: ${translateCount}`);
  }
  if (colonTagForms > 0) {
    issues.push(`Speaker tag format still contains colon variants: ${colonTagForms}`);
  }
  if (polishBuckets.genericLabelCount > 0) {
    issues.push(
      `Generic speaker labels present: ${polishBuckets.genericLabelCount} variants / ${polishBuckets.genericLabelHits} hits`
    );
  }
  if (polishBuckets.hostVariantCount > 1) {
    issues.push(`Host label variants exceed one canonical form: ${polishBuckets.hostVariantCount}`);
  }

  const mismatch = llmPolish
    ? detectLanguageMismatch({
        podcastLanguage: podcast.language,
        transcriptLanguage: llmPolish.language,
        source: llmPolish.source,
        speakerCounts: polishSpeakerCounts,
      })
    : null;
  if (mismatch) issues.push(mismatch);

  const needsSourceRecovery =
    podcast.language?.startsWith('en') &&
    transcripts.some(t => t.source === 'youtube_manual' && t.language?.startsWith('zh'));
  if (needsSourceRecovery) {
    issues.push('Source transcript is Chinese for an English podcast; recover English source before repolish');
  }

  const needsManualSpeakerReview =
    !!llmPolish &&
    (
      (polishBuckets.genericLabelHits >= 10 && polishBuckets.realNamedSpeakers <= 1) ||
      (polishBuckets.genericLabelHits > 0 && polishBuckets.realNamedSpeakers === 0)
    );
  if (needsManualSpeakerReview) {
    issues.push('Speaker attribution likely needs diarization/manual review');
  }

  return {
    episodeId: episode.id,
    title: episode.title,
    publishedDate: episode.published_date,
    issues,
    stats: {
      transcriptSources: Object.fromEntries(Object.entries(grouped).map(([k, v]) => [k, v.length])),
      llmPolishLanguage: llmPolish?.language || null,
      llmPolishSpeakerCounts: polishSpeakerCounts,
      colonTagForms,
      genericLabelVariants: polishBuckets.genericLabelCount,
      genericLabelHits: polishBuckets.genericLabelHits,
      hostVariantCount: polishBuckets.hostVariantCount,
    },
  };
}

function prioritizeEpisode(audit) {
  const joined = audit.issues.join(' | ');
  if (joined.includes('recover English source')) return 1;
  if (joined.includes('diarization/manual review')) return 2;
  if (joined.includes('Duplicate llm_translate')) return 3;
  if (joined.includes('Generic speaker labels')) return 4;
  if (joined.includes('Host label variants')) return 5;
  if (joined.includes('colon variants')) return 6;
  return 9;
}

module.exports = {
  auditEpisode,
  countColonTagForms,
  detectLanguageMismatch,
  extractBracketedSpeakerCounts,
  prioritizeEpisode,
  summarizeSpeakerBuckets,
};
