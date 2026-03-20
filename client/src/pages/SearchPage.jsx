import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import './SearchPage.css';

const TYPE_LABELS = {
  all: '全部',
  podcast: '播客',
  episode: '节目',
  transcript: '文字稿'
};

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [activeType, setActiveType] = useState(searchParams.get('type') || 'all');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const doSearch = useCallback((q, type) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ q, type, limit: 20 });
    fetch(`/api/search?${params}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setResults(data.results);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const q = searchParams.get('q') || '';
    const type = searchParams.get('type') || 'all';
    setQuery(q);
    setActiveType(type);
    if (q) doSearch(q, type);
  }, [searchParams]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (query.trim()) {
      setSearchParams({ q: query.trim(), type: activeType });
    }
  };

  const handleTypeChange = (type) => {
    setActiveType(type);
    if (query.trim()) {
      setSearchParams({ q: query.trim(), type });
    }
  };

  const totalResults = results
    ? (results.podcasts?.length || 0) + (results.episodes?.length || 0) + (results.transcripts?.length || 0)
    : 0;

  return (
    <div className="page search-page">
      <div className="search-page-header">
        <h1 className="search-page-title">探索内容</h1>
        <p className="search-page-subtitle">搜索播客、节目、文字稿内容</p>
      </div>

      <form className="search-page-form" onSubmit={handleSubmit}>
        <div className="search-bar-large">
          <svg className="search-bar-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="search"
            className="search-bar-input"
            placeholder="搜索播客名称、主播、内容..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          <button type="submit" className="search-bar-btn">搜索</button>
        </div>

        <div className="search-type-tabs">
          {Object.entries(TYPE_LABELS).map(([type, label]) => (
            <button
              key={type}
              type="button"
              className={`type-tab ${activeType === type ? 'type-tab--active' : ''}`}
              onClick={() => handleTypeChange(type)}
            >
              {label}
              {results && type !== 'all' && (
                <span className="type-count">
                  {type === 'podcast' ? results.podcasts?.length :
                   type === 'episode' ? results.episodes?.length :
                   results.transcripts?.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </form>

      {loading && (
        <div className="search-loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="search-result-skeleton">
              <div className="skeleton" style={{ width: 48, height: 48, borderRadius: 8 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ height: 16, width: '60%', marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 12, width: '40%' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="search-error">
          <p>搜索失败：{error}</p>
        </div>
      )}

      {!loading && results && (
        <div className="search-results">
          {totalResults === 0 ? (
            <div className="no-results">
              <div className="no-results-icon">🔍</div>
              <h2>未找到相关结果</h2>
              <p>尝试使用不同的关键词搜索</p>
            </div>
          ) : (
            <div className="results-summary">
              找到 <strong>{totalResults}</strong> 个相关结果
            </div>
          )}

          {/* Podcasts */}
          {(activeType === 'all' || activeType === 'podcast') && results.podcasts?.length > 0 && (
            <section className="results-section">
              <h2 className="results-section-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                  <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
                  <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                </svg>
                播客
                <span className="results-count">{results.podcasts.length}</span>
              </h2>
              <div className="results-grid results-grid--podcasts">
                {results.podcasts.map(podcast => (
                  <Link key={podcast.id} to={`/podcasts/${podcast.id}`} className="result-card podcast-result">
                    <div className="result-img">
                      {podcast.image_url ? (
                        <img src={podcast.image_url} alt={podcast.name} />
                      ) : (
                        <div className="result-avatar">{(podcast.name || '?')[0]}</div>
                      )}
                    </div>
                    <div className="result-body">
                      <h3 dangerouslySetInnerHTML={{ __html: podcast.name_snippet || podcast.name }} />
                      {podcast.host_snippet && (
                        <p className="result-sub" dangerouslySetInnerHTML={{ __html: podcast.host_snippet }} />
                      )}
                      <div className="result-meta">
                        <span>{podcast.episode_count} 期</span>
                        {podcast.category && <span className="result-tag">{podcast.category}</span>}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Episodes */}
          {(activeType === 'all' || activeType === 'episode') && results.episodes?.length > 0 && (
            <section className="results-section">
              <h2 className="results-section-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polygon points="10 8 16 12 10 16 10 8" />
                </svg>
                节目
                <span className="results-count">{results.episodes.length}</span>
              </h2>
              <div className="results-list">
                {results.episodes.map(ep => (
                  <Link key={ep.id} to={`/episodes/${ep.id}`} className="result-row">
                    <div className="result-row-body">
                      <div className="result-row-top">
                        <h3 dangerouslySetInnerHTML={{ __html: ep.title_snippet || ep.title }} />
                        {ep.has_transcript ? <span className="transcript-badge">文字稿</span> : null}
                      </div>
                      {ep.description_snippet && (
                        <p className="result-row-desc" dangerouslySetInnerHTML={{ __html: ep.description_snippet }} />
                      )}
                      <div className="result-meta">
                        <span>{ep.podcast_name}</span>
                        {ep.published_date && <span>{new Date(ep.published_date).toLocaleDateString('zh-CN')}</span>}
                        {ep.guests_snippet && <span dangerouslySetInnerHTML={{ __html: ep.guests_snippet }} />}
                      </div>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="arrow-icon">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Transcripts */}
          {(activeType === 'all' || activeType === 'transcript') && results.transcripts?.length > 0 && (
            <section className="results-section">
              <h2 className="results-section-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                文字稿
                <span className="results-count">{results.transcripts.length}</span>
              </h2>
              <div className="results-list">
                {results.transcripts.map(tr => (
                  <Link key={tr.id} to={`/episodes/${tr.episode_id}`} className="result-row transcript-result">
                    <div className="result-row-body">
                      <h3>{tr.episode_title}</h3>
                      <div className="transcript-snippet" dangerouslySetInnerHTML={{ __html: tr.content_snippet }} />
                      <div className="result-meta">
                        <span>{tr.podcast_name}</span>
                        <span className="result-tag">{tr.podcast_category || ''}</span>
                      </div>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="arrow-icon">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {!loading && !results && !error && (
        <div className="search-hints">
          <h2>热门搜索</h2>
          <div className="hint-tags">
            {['科技', '创业', '投资', '人工智能', '历史', '心理学'].map(tag => (
              <button
                key={tag}
                className="hint-tag"
                onClick={() => {
                  setQuery(tag);
                  setSearchParams({ q: tag, type: activeType });
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
