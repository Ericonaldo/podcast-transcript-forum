import React, { useState, useCallback, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import './Header.css';

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);
  return [theme, () => setTheme(t => t === 'dark' ? 'light' : 'dark')];
}

export default function Header({ onMenuToggle }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [theme, toggleTheme] = useTheme();

  const handleSearch = useCallback((e) => {
    e.preventDefault();
    const q = query.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
  }, [query, navigate]);

  return (
    <header className="header">
      <div className="header-left">
        <button className="menu-btn" onClick={onMenuToggle} aria-label="Toggle menu">
          <span className="menu-icon">
            <span /><span /><span />
          </span>
        </button>
        <Link to="/" className="logo">
          <span className="logo-icon">◉</span>
          <span className="logo-text">PodScribe</span>
        </Link>
      </div>

      <form className="search-form" onSubmit={handleSearch} role="search">
        <div className="search-wrapper">
          <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="search"
            className="search-input"
            placeholder="搜索播客、剧集、内容..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="搜索"
          />
          {query && (
            <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="清除">
              ×
            </button>
          )}
        </div>
        <button type="submit" className="search-btn">搜索</button>
      </form>

      <nav className="header-nav">
        <Link to="/" className="nav-link">首页</Link>
        <Link to="/search" className="nav-link">探索</Link>
        <Link to="/upload" className="nav-link nav-link--upload">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          上传
        </Link>
        <button className="theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? '切换亮色模式' : '切换深色模式'}>
          {theme === 'dark' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          )}
        </button>
      </nav>
    </header>
  );
}
