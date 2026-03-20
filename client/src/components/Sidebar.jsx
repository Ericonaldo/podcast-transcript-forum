import React from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import './Sidebar.css';

const CATEGORY_ICONS = {
  '科技': '🔬',
  '商业': '💼',
  '文化': '🎨',
  '教育': '📚',
  '新闻': '📰',
  '娱乐': '🎭',
  '健康': '🏃',
  '财经': '📈',
  '历史': '🏛️',
  '科学': '🔭',
  '哲学': '🧠',
  '社会': '🌏',
  'Technology': '🔬',
  'Business': '💼',
  'Culture': '🎨',
  'Education': '📚',
  'News': '📰',
  'Entertainment': '🎭',
  'Health': '🏃',
  'Finance': '📈',
  'History': '🏛️',
  'Science': '🔭',
};

export default function Sidebar({ isOpen, categories, onClose }) {
  const location = useLocation();
  const params = useParams();

  const isActive = (path) => location.pathname === path;
  const isCategoryActive = (cat) => location.pathname === `/category/${encodeURIComponent(cat)}`;

  return (
    <aside className={`sidebar ${isOpen ? 'sidebar--open' : ''}`}>
      <div className="sidebar-section">
        <div className="sidebar-label">导航</div>
        <nav className="sidebar-nav">
          <Link to="/" className={`sidebar-link ${isActive('/') ? 'sidebar-link--active' : ''}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            全部播客
          </Link>
          <Link to="/search" className={`sidebar-link ${isActive('/search') ? 'sidebar-link--active' : ''}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            探索内容
          </Link>
        </nav>
      </div>

      {categories.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-label">分类</div>
          <nav className="sidebar-nav">
            {categories.map(cat => (
              <Link
                key={cat.category}
                to={`/category/${encodeURIComponent(cat.category)}`}
                className={`sidebar-link ${isCategoryActive(cat.category) ? 'sidebar-link--active' : ''}`}
              >
                <span className="cat-icon">
                  {CATEGORY_ICONS[cat.category] || '🎙️'}
                </span>
                <span className="cat-name">{cat.category}</span>
                <span className="cat-count">{cat.count}</span>
              </Link>
            ))}
          </nav>
        </div>
      )}

      <div className="sidebar-footer">
        <p className="sidebar-footer-text">
          PodScribe · 播客文字稿
        </p>
      </div>
    </aside>
  );
}
