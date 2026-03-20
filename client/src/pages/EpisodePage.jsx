import React, { useState, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
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

// Parse transcript content - support plain text, VTT, SRT
function parseTranscript(content, format) {
  if (!content) return [];

  if (format === 'vtt' || format === 'srt') {
    // Parse VTT/SRT cue blocks
    const blocks = [];
    const lines = content.split('\n');
    let current = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.includes('-->')) {
        if (current) blocks.push(current);
        const [start] = trimmed.split('-->').map(t => t.trim());
        current = { timestamp: start, text: '' };
      } else if (current && trimmed && !trimmed.match(/^\d+$/) && trimmed !== 'WEBVTT') {
        current.text += (current.text ? ' ' : '') + trimmed;
      }
    }
    if (current) blocks.push(current);
    return blocks;
  }

  // Plain text - split into paragraphs
  const paragraphs = content.split(/\n{2,}/).filter(p => p.trim());
  return paragraphs.map(p => ({ text: p.trim() }));
}

export default function EpisodePage() {
  const { id } = useParams();
  const [episode, setEpisode] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fontSize, setFontSize] = useState('md');
  const [showToc, setShowToc] = useState(false);
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
                </div>
              </div>

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
          ) : (
            <div className="no-transcript">
              <div className="no-transcript-icon">📝</div>
              <h3>暂无文字稿</h3>
              <p>该节目尚未提供文字稿内容</p>
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
