import React, { useState, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import ContributeModal from '../components/ContributeModal';
import TranscriptEditor from '../components/TranscriptEditor';
import RevisionHistory from '../components/RevisionHistory';
import './EpisodePage.css';

function formatDuration(seconds) {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return dateStr; }
}

// Format seconds to MM:SS or HH:MM:SS
function secsToTimecode(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function parseVTTTimestamp(ts) {
  const parts = ts.trim().split(':');
  if (parts.length === 3) return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  if (parts.length === 2) return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  return parseFloat(parts[0] || 0);
}

function stripVTTTags(text) {
  return text
    .replace(/<\d{1,2}:\d{2}:\d{2}[.,]\d{3}>/g, '')  // inline timestamp tags
    .replace(/<\/?[a-z][^>]*>/gi, '')                   // VTT/HTML tags
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .trim();
}

// Parse transcript content - support plain text, VTT, SRT
function parseTranscript(content, format) {
  if (!content) return [];

  if (format === 'vtt') {
    const rawCues = [];

    // Detect YouTube auto-caption rolling format (has <c> inline timing tags)
    const isYouTubeAutoCaption = /<\d{1,2}:\d{2}:\d{2}[.,]\d{3}>/.test(content);

    // Split into cue blocks (separated by blank lines)
    const cueBlocks = content.split(/\n\s*\n/);
    for (const block of cueBlocks) {
      const lines = block.trim().split('\n').map(l => l.trim()).filter(Boolean);
      if (!lines.length) continue;
      // Skip header lines
      if (/^(WEBVTT|NOTE|STYLE|Kind:|Language:)/.test(lines[0])) continue;

      // Find timing line
      const timingIdx = lines.findIndex(l => l.includes('-->'));
      if (timingIdx === -1) continue;
      const timingMatch = lines[timingIdx].match(/(\d[\d:.]+)\s*-->\s*(\d[\d:.]+)/);
      if (!timingMatch) continue;

      const startSec = parseVTTTimestamp(timingMatch[1]);
      const endSec = parseVTTTimestamp(timingMatch[2]);

      // Skip flash cues < 0.15s — YouTube uses these as "settled" duplicate cues
      if (endSec - startSec < 0.15) continue;

      // Get text lines, strip all VTT/timing tags
      const textLines = lines.slice(timingIdx + 1)
        .map(stripVTTTags)
        .filter(l => l.length > 0);
      if (!textLines.length) continue;

      if (isYouTubeAutoCaption) {
        // YouTube rolling captions: each cue shows [previous line, new words]
        // Take only the LAST line to avoid duplicating content from prior cue
        rawCues.push({ startSec, text: textLines[textLines.length - 1] });
      } else {
        // Clean VTT: take ALL text lines joined
        rawCues.push({ startSec, text: textLines.join(' ') });
      }
    }

    if (!rawCues.length) return [];

    // Group into ~60-second paragraphs for readability
    const WINDOW = 60;
    const grouped = [];
    let winStart = rawCues[0].startSec;
    let winTexts = [];

    for (const cue of rawCues) {
      if (cue.startSec - winStart >= WINDOW && winTexts.length > 0) {
        grouped.push({ timestamp: secsToTimecode(winStart), text: winTexts.join(' ') });
        winStart = cue.startSec;
        winTexts = [];
      }
      winTexts.push(cue.text);
    }
    if (winTexts.length > 0) {
      grouped.push({ timestamp: secsToTimecode(winStart), text: winTexts.join(' ') });
    }
    return grouped;
  }

  if (format === 'srt') {
    const rawCues = [];
    const cueBlocks = content.replace(/\r\n/g, '\n').split(/\n\s*\n/);
    for (const block of cueBlocks) {
      const lines = block.trim().split('\n');
      const timingIdx = lines.findIndex(l => l.includes('-->'));
      if (timingIdx === -1) continue;
      const startMatch = lines[timingIdx].match(/(\d{1,2}:\d{2}:\d{2}[,.]?\d*)/);
      if (!startMatch) continue;
      const startSec = parseVTTTimestamp(startMatch[1].replace(',', '.'));
      const text = lines.slice(timingIdx + 1).map(stripVTTTags).filter(Boolean).join(' ');
      if (text) rawCues.push({ startSec, text });
    }
    // Group SRT into 60-second paragraphs too
    const WINDOW = 60;
    const grouped = [];
    if (!rawCues.length) return [];
    let winStart = rawCues[0].startSec;
    let winTexts = [];
    for (const cue of rawCues) {
      if (cue.startSec - winStart >= WINDOW && winTexts.length > 0) {
        grouped.push({ timestamp: secsToTimecode(winStart), text: winTexts.join(' ') });
        winStart = cue.startSec;
        winTexts = [];
      }
      winTexts.push(cue.text);
    }
    if (winTexts.length > 0) grouped.push({ timestamp: secsToTimecode(winStart), text: winTexts.join(' ') });
    return grouped;
  }

  // Plain text — split into paragraphs, support [MM:SS] timestamp prefix
  const paragraphs = content.split(/\n{1,}/).filter(p => p.trim());
  return paragraphs.map(p => {
    const m = p.trim().match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)/s);
    if (m) return { timestamp: m[1], text: m[2].trim() };
    return { text: p.trim() };
  }).filter(b => b.text);
}

export default function EpisodePage() {
  const { id } = useParams();
  const [episode, setEpisode] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fontSize, setFontSize] = useState('md');
  const [showContribute, setShowContribute] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const transcriptRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/episodes/${id}`).then(r => r.json()),
      fetch(`/api/episodes/${id}/transcript`).then(r => r.ok ? r.json() : null).catch(() => null)
    ]).then(([ep, tr]) => {
      setEpisode(ep);
      setTranscript(tr);
    }).finally(() => setLoading(false));
  }, [id]);

  function handleContributeSuccess(newTranscript) {
    setTranscript(newTranscript);
    setShowContribute(false);
    setShowHistory(false);
  }

  function handleEditSuccess(revision) {
    // Update transcript content from revision
    setTranscript(prev => prev
      ? { ...prev, content: revision.content, updated_at: revision.created_at }
      : { episode_id: parseInt(id), content: revision.content, source: 'community_edit' }
    );
    setEditMode(false);
    setShowHistory(true); // Show history panel to see the new commit
  }

  function handleRestore(revision) {
    setTranscript(prev => prev
      ? { ...prev, content: revision.content }
      : null
    );
    setShowHistory(false);
  }

  const blocks = transcript ? parseTranscript(transcript.content, transcript.format) : [];
  const wordCount = transcript ? transcript.content.replace(/\s+/g, ' ').trim().split(' ').length : 0;
  const readTime = Math.ceil(wordCount / 300);

  if (loading) {
    return (
      <div className="page episode-page">
        <div className="ep-loading-hero skeleton" style={{ height: 200, borderRadius: 16 }} />
        <div className="ep-loading-body" style={{ padding: '32px' }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 16, marginBottom: 12, width: `${70 + Math.random()*30}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (!episode || episode.error) {
    return (
      <div className="page episode-page">
        <div className="empty-state">
          <div className="empty-icon">🎧</div>
          <h2>节目不存在</h2>
          <Link to="/" className="back-link">返回首页</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page episode-page">
      {/* Contribute Modal */}
      {showContribute && (
        <ContributeModal
          episode={episode}
          onClose={() => setShowContribute(false)}
          onSuccess={handleContributeSuccess}
        />
      )}

      {/* Breadcrumb */}
      <div className="breadcrumb">
        <Link to="/" className="bc-link">首页</Link>
        <span className="bc-sep">›</span>
        <Link to={`/podcasts/${episode.podcast_id}`} className="bc-link">{episode.podcast_name}</Link>
        <span className="bc-sep">›</span>
        <span className="bc-current">{episode.title}</span>
      </div>

      {/* Episode header */}
      <div className="ep-header">
        <div className="ep-meta-top">
          {episode.podcast_category && (
            <Link to={`/category/${encodeURIComponent(episode.podcast_category)}`} className="ep-category">
              {episode.podcast_category}
            </Link>
          )}
          {episode.published_date && (
            <time className="ep-date">{formatDate(episode.published_date)}</time>
          )}
        </div>
        <h1 className="ep-title">{episode.title}</h1>
        <div className="ep-hosts">
          {episode.podcast_host && (
            <span className="ep-host">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              {episode.podcast_host}
            </span>
          )}
          {episode.guests && (
            <span className="ep-guests">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              嘉宾：{episode.guests}
            </span>
          )}
        </div>
        <div className="ep-actions">
          {episode.audio_url && (
            <a href={episode.audio_url} target="_blank" rel="noopener noreferrer" className="btn-play">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              收听音频
            </a>
          )}
          {episode.episode_url && (
            <a href={episode.episode_url} target="_blank" rel="noopener noreferrer" className="btn-ep-link">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              原链接
            </a>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="ep-content-layout">
        {/* Transcript */}
        <div className="ep-transcript-area">
          {transcript ? (
            <>
              {/* Edit mode */}
              {editMode ? (
                <div className="ep-edit-mode">
                  <div className="ep-edit-mode-header">
                    <h2 className="transcript-label">编辑文字稿</h2>
                  </div>
                  <TranscriptEditor
                    episodeId={id}
                    originalContent={transcript.content}
                    onCancel={() => setEditMode(false)}
                    onSuccess={handleEditSuccess}
                  />
                </div>
              ) : (
                <>
                  <div className="transcript-toolbar">
                    <div className="toolbar-left">
                      <h2 className="transcript-label">文字稿</h2>
                      <div className="transcript-stats">
                        <span>{wordCount.toLocaleString()} 字</span>
                        <span>约 {readTime} 分钟</span>
                        <span className="transcript-source">来源: {transcript.source}</span>
                      </div>
                    </div>
                    <div className="toolbar-right">
                      <div className="font-size-ctrl">
                        {['sm', 'md', 'lg'].map(size => (
                          <button
                            key={size}
                            className={`font-btn ${fontSize === size ? 'font-btn--active' : ''}`}
                            onClick={() => setFontSize(size)}
                            title={{ sm: '小', md: '中', lg: '大' }[size]}
                          >
                            A
                          </button>
                        ))}
                      </div>
                      <button
                        className="btn-history"
                        onClick={() => setShowHistory(v => !v)}
                        title="查看修改历史"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/>
                        </svg>
                        历史
                      </button>
                      <button
                        className="btn-edit-transcript"
                        onClick={() => setEditMode(true)}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        我要修改
                      </button>
                    </div>
                  </div>

                  {/* Revision history panel (collapsible) */}
                  {showHistory && (
                    <RevisionHistory
                      episodeId={id}
                      onRestore={handleRestore}
                    />
                  )}

                  <div ref={transcriptRef} className={`transcript-body font-size--${fontSize}`}>
                    {blocks.map((block, idx) => (
                      <div key={idx} className={`transcript-block ${block.timestamp ? 'has-timestamp' : ''}`}>
                        {block.timestamp && (
                          <span className="block-timestamp">{block.timestamp}</span>
                        )}
                        <p className="block-text">{block.text}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            /* No transcript — show contribute CTA */
            <div className="no-transcript">
              <div className="no-transcript-icon">📝</div>
              <h3>暂无文字稿</h3>
              <p>该节目尚未提供文字稿内容</p>
              <div className="contribute-cta">
                <button
                  className="btn-contribute"
                  onClick={() => setShowContribute(true)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                  </svg>
                  我来贡献文字稿
                </button>
                <p className="contribute-hint">
                  使用 EchoShell 插件自动转译，或手动粘贴文字稿。
                  点击按钮查看详细说明。
                </p>
              </div>
              {episode.audio_url && (
                <a href={episode.audio_url} target="_blank" rel="noopener noreferrer" className="btn-play" style={{ marginTop: 16 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  前往收听
                </a>
              )}
            </div>
          )}
        </div>

        {/* Sidebar info */}
        <aside className="ep-aside">
          <div className="ep-aside-card">
            <h3 className="aside-title">节目信息</h3>
            <dl className="ep-details">
              {episode.duration && (
                <div className="ep-detail-row">
                  <dt>时长</dt>
                  <dd>{formatDuration(episode.duration)}</dd>
                </div>
              )}
              {episode.episode_number && (
                <div className="ep-detail-row">
                  <dt>期数</dt>
                  <dd>第 {episode.episode_number} 期</dd>
                </div>
              )}
              {episode.season_number && (
                <div className="ep-detail-row">
                  <dt>季节</dt>
                  <dd>第 {episode.season_number} 季</dd>
                </div>
              )}
              {episode.published_date && (
                <div className="ep-detail-row">
                  <dt>发布</dt>
                  <dd>{formatDate(episode.published_date)}</dd>
                </div>
              )}
              {transcript && (
                <div className="ep-detail-row">
                  <dt>文字稿</dt>
                  <dd className="has-transcript-indicator">已收录</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Community contribution card */}
          {!transcript && (
            <div className="ep-aside-card ep-aside-card--contribute">
              <h3 className="aside-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
                贡献文字稿
              </h3>
              <p className="aside-desc">帮助社区，贡献这期节目的文字稿。</p>
              <button className="btn-contribute-sm" onClick={() => setShowContribute(true)}>
                我来贡献 →
              </button>
            </div>
          )}

          {transcript && (
            <div className="ep-aside-card ep-aside-card--edit">
              <h3 className="aside-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/>
                </svg>
                社区协作
              </h3>
              <p className="aside-desc">发现错误？欢迎修正文字稿，每次修改都会被记录。</p>
              <div className="aside-actions">
                <button className="btn-contribute-sm" onClick={() => setEditMode(true)}>
                  我要修改
                </button>
                <button className="btn-ghost-xs" onClick={() => setShowHistory(v => !v)}>
                  {showHistory ? '隐藏历史' : '查看历史'}
                </button>
              </div>
            </div>
          )}

          {episode.description && (
            <div className="ep-aside-card">
              <h3 className="aside-title">节目简介</h3>
              <p className="ep-description-text">{episode.description}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
