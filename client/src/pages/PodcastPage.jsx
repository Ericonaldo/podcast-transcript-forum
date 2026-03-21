import React, { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import './PodcastPage.css';

function formatDuration(seconds) {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

export default function PodcastPage() {
  const { id } = useParams();
  const [podcast, setPodcast] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [epLoading, setEpLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/podcasts/${id}`)
      .then(r => r.json())
      .then(setPodcast)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    setEpLoading(true);
    fetch(`/api/podcasts/${id}/episodes?page=${page}&limit=20`)
      .then(r => r.json())
      .then(data => {
        setEpisodes(prev => page === 1 ? data.data : [...prev, ...data.data]);
        setPagination(data.pagination);
      })
      .catch(() => {})
      .finally(() => setEpLoading(false));
  }, [id, page]);

  if (loading) {
    return (
      <div className="page podcast-page">
        <div className="podcast-hero skeleton" style={{ height: 200, borderRadius: 16 }} />
      </div>
    );
  }

  if (!podcast) {
    return (
      <div className="page podcast-page">
        <div className="empty-state">
          <div className="empty-icon">🎙️</div>
          <h2>播客不存在</h2>
          <Link to="/" className="back-link">返回首页</Link>
        </div>
      </div>
    );
  }

  const initial = (podcast.name || '?')[0].toUpperCase();

  return (
    <div className="page podcast-page">
      {/* Hero section */}
      <div className="podcast-hero">
        <div className="podcast-hero-bg">
          {podcast.image_url && <img src={podcast.image_url} alt="" aria-hidden />}
        </div>
        <div className="podcast-hero-content">
          <div className="podcast-cover">
            {podcast.image_url ? (
              <img src={podcast.image_url} alt={podcast.name} />
            ) : (
              <div className="podcast-avatar-lg">
                <span>{initial}</span>
              </div>
            )}
          </div>
          <div className="podcast-info">
            <div className="podcast-badges">
              {podcast.category && (
                <Link to={`/category/${encodeURIComponent(podcast.category)}`} className="badge badge-category">
                  {podcast.category}
                </Link>
              )}
              {podcast.language && (
                <span className="badge badge-lang">{podcast.language.toUpperCase()}</span>
              )}
            </div>
            <h1 className="podcast-title">{podcast.name}</h1>
            {podcast.host && (
              <p className="podcast-host">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                {podcast.host}
              </p>
            )}
            {podcast.description && (
              <p className="podcast-desc">{podcast.description}</p>
            )}
            <div className="podcast-stats">
              <div className="stat">
                <span className="stat-value">{podcast.episode_count || 0}</span>
                <span className="stat-label">期节目</span>
              </div>
              <div className="stat">
                <span className="stat-value">{podcast.transcript_count || 0}</span>
                <span className="stat-label">文字稿</span>
              </div>
            </div>
            <div className="podcast-actions">
              {podcast.website_url && (
                <a href={podcast.website_url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  访问官网
                </a>
              )}
              {podcast.rss_url && (
                <a href={podcast.rss_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 11a9 9 0 0 1 9 9" />
                    <path d="M4 4a16 16 0 0 1 16 16" />
                    <circle cx="5" cy="19" r="1" />
                  </svg>
                  RSS
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Episodes list */}
      <div className="episodes-section">
        <div className="section-header">
          <h2 className="section-title">全部节目</h2>
          {pagination && <span className="count-badge">{pagination.total} 期</span>}
        </div>

        <div className="episodes-list">
          {episodes.map((ep, idx) => (
            <EpisodeRow key={ep.id} episode={ep} index={idx} />
          ))}
          {epLoading && (
            <div className="ep-loading">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 80, borderRadius: 10, marginBottom: 8 }} />
              ))}
            </div>
          )}
        </div>

        {pagination && page < pagination.pages && !epLoading && (
          <div className="load-more-container">
            <button className="load-more-btn" onClick={() => setPage(p => p + 1)}>
              加载更多
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function EpisodeRow({ episode }) {
  return (
    <Link to={`/episodes/${episode.id}`} className="episode-row">
      <div className="episode-row-left">
        {episode.image_url ? (
          <img src={episode.image_url} alt="" className="episode-thumb" loading="lazy" />
        ) : (
          <div className="episode-number">
            {episode.episode_number ? `E${episode.episode_number}` : '•'}
          </div>
        )}
      </div>
      <div className="episode-row-body">
        <div className="episode-row-top">
          <h3 className="episode-row-title">{episode.title}</h3>
          {episode.has_transcript ? (
            <span className="transcript-badge">文字稿</span>
          ) : null}
        </div>
        {episode.description && (
          <p className="episode-row-desc">{episode.description}</p>
        )}
        <div className="episode-row-meta">
          {episode.published_date && (
            <span className="ep-meta-item">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              {formatDate(episode.published_date)}
            </span>
          )}
          {episode.duration && (
            <span className="ep-meta-item">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {formatDuration(episode.duration)}
            </span>
          )}
          {episode.guests && (
            <span className="ep-meta-item">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              {episode.guests}
            </span>
          )}
        </div>
      </div>
      <div className="episode-row-action">
        {episode.episode_url && (
          <a
            href={episode.episode_url}
            target="_blank"
            rel="noopener noreferrer"
            className="video-btn"
            onClick={e => e.stopPropagation()}
            title="观看视频"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <polyline points="8 21 12 17 16 21" />
              <polygon points="10 8 15 11 10 14 10 8" fill="currentColor" stroke="none" />
            </svg>
          </a>
        )}
        {episode.audio_url && (
          <a
            href={episode.audio_url}
            target="_blank"
            rel="noopener noreferrer"
            className="play-btn"
            onClick={e => e.stopPropagation()}
            title="收听音频"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </a>
        )}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="arrow-icon">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </Link>
  );
}
