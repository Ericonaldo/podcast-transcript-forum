import React from 'react';
import { Link } from 'react-router-dom';
import './PodcastCard.css';

export default function PodcastCard({ podcast }) {
  const initial = (podcast.name || '?')[0].toUpperCase();

  return (
    <Link to={`/podcasts/${podcast.id}`} className="podcast-card">
      <div className="podcast-card-img">
        {podcast.image_url ? (
          <img src={podcast.image_url} alt={podcast.name} loading="lazy" />
        ) : (
          <div className="podcast-avatar" data-initial={initial}>
            <span>{initial}</span>
          </div>
        )}
      </div>
      <div className="podcast-card-body">
        <h3 className="podcast-card-name">{podcast.name}</h3>
        {podcast.host && (
          <p className="podcast-card-host">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            {podcast.host}
          </p>
        )}
        {podcast.description && (
          <p className="podcast-card-desc">{podcast.description}</p>
        )}
        <div className="podcast-card-meta">
          <span className="meta-item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
            </svg>
            {podcast.episode_count || 0} 期
          </span>
          {podcast.transcript_count > 0 && (
            <span className="meta-item meta-transcript">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              {podcast.transcript_count} 稿
            </span>
          )}
          {podcast.category && (
            <span className="meta-item meta-category">{podcast.category}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
