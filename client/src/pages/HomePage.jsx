import React, { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import PodcastCard from '../components/PodcastCard';
import './HomePage.css';

export default function HomePage() {
  const { category } = useParams();
  const [podcasts, setPodcasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [sort, setSort] = useState('name');
  const [langFilter, setLangFilter] = useState('all'); // 'all' | 'zh' | 'en'

  useEffect(() => {
    setPage(1);
    setPodcasts([]);
  }, [category, sort]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page, limit: 24, sort });
    if (category) params.set('category', category);
    fetch(`/api/podcasts?${params}`)
      .then(r => r.json())
      .then(data => {
        setPodcasts(prev => page === 1 ? data.data : [...prev, ...data.data]);
        setPagination(data.pagination);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [category, page, sort]);

  const hasMore = pagination && page < pagination.pages;

  return (
    <div className="page home-page">
      <div className="page-header">
        <div className="page-title-row">
          <h1 className="page-title">
            {category ? (
              <>
                <span className="title-tag">分类</span>
                {category}
              </>
            ) : '全部播客'}
          </h1>
          {pagination && (
            <span className="count-badge">{pagination.total} 个播客</span>
          )}
        </div>
        <div className="sort-bar">
          <div className="filter-group">
            <span className="sort-label">语言：</span>
            {[
              { value: 'all', label: '全部' },
              { value: 'zh', label: '中文' },
              { value: 'en', label: 'English' },
            ].map(f => (
              <button
                key={f.value}
                className={`sort-btn ${langFilter === f.value ? 'sort-btn--active' : ''}`}
                onClick={() => setLangFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="filter-group">
            <span className="sort-label">排序：</span>
            {[
              { value: 'name', label: '名称' },
              { value: 'episodes', label: '期数' },
              { value: 'created', label: '添加时间' },
            ].map(s => (
              <button
                key={s.value}
                className={`sort-btn ${sort === s.value ? 'sort-btn--active' : ''}`}
                onClick={() => setSort(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="error-state">
          <p>加载失败：{error}</p>
          <button onClick={() => setPage(1)}>重试</button>
        </div>
      )}

      {!loading && podcasts.length === 0 && !error && (
        <div className="empty-state">
          <div className="empty-icon">🎙️</div>
          <h2>暂无播客</h2>
          <p>当前{category ? `「${category}」分类` : ''}还没有播客内容</p>
        </div>
      )}

      <div className="podcast-grid">
        {podcasts
          .filter(p => {
            if (langFilter === 'all') return true;
            if (langFilter === 'zh') return p.language && p.language.startsWith('zh');
            return !p.language || !p.language.startsWith('zh');
          })
          .map(podcast => (
            <PodcastCard key={podcast.id} podcast={podcast} />
          ))}
      </div>
      {loading && (
        <div className="podcast-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="podcast-card-skeleton">
              <div className="skeleton" style={{ height: 80, marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 18, width: '70%', marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 14, width: '50%' }} />
            </div>
          ))}
        </div>
      )}

      {hasMore && !loading && (
        <div className="load-more-container">
          <button className="load-more-btn" onClick={() => setPage(p => p + 1)}>
            加载更多
          </button>
        </div>
      )}
    </div>
  );
}
