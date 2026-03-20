import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function UploadPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    podcastName: '',
    podcastHost: '',
    podcastCategory: '',
    podcastLanguage: 'zh',
    episodeTitle: '',
    episodeUrl: '',
    episodeDescription: '',
    transcriptContent: '',
    transcriptLanguage: 'zh',
    transcriptSource: 'manual',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(null);

    if (!form.podcastName.trim()) return setError('Podcast name is required');
    if (!form.episodeTitle.trim()) return setError('Episode title is required');
    if (!form.transcriptContent.trim()) return setError('Transcript content is required');

    setSubmitting(true);
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          podcast: {
            name: form.podcastName.trim(),
            host: form.podcastHost.trim() || undefined,
            category: form.podcastCategory.trim() || undefined,
            language: form.podcastLanguage,
          },
          episode: {
            title: form.episodeTitle.trim(),
            episode_url: form.episodeUrl.trim() || undefined,
            description: form.episodeDescription.trim() || undefined,
          },
          transcript: {
            content: form.transcriptContent.trim(),
            language: form.transcriptLanguage,
            source: form.transcriptSource,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }
      const data = await res.json();
      setSuccess(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="upload-success">
        <div className="upload-success-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="9 12 11 14 15 10" />
          </svg>
        </div>
        <h2>Transcript uploaded!</h2>
        <p>Your transcript has been shared with the community.</p>
        <div className="upload-success-actions">
          <button className="btn-primary" onClick={() => navigate(`/episodes/${success.episodeId}`)}>
            View Transcript
          </button>
          <button className="btn-ghost" onClick={() => { setSuccess(null); setForm({ podcastName:'', podcastHost:'', podcastCategory:'', podcastLanguage:'zh', episodeTitle:'', episodeUrl:'', episodeDescription:'', transcriptContent:'', transcriptLanguage:'zh', transcriptSource:'manual' }); }}>
            Upload Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="upload-page">
      <div className="upload-header">
        <h1 className="page-title">Upload Transcript</h1>
        <p className="page-desc">Share a podcast transcript with the community. No account needed — uploads are anonymous.</p>
      </div>

      {error && (
        <div className="upload-error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}

      <form className="upload-form" onSubmit={handleSubmit}>
        {/* Podcast info */}
        <section className="upload-section">
          <h2 className="upload-section-title">Podcast</h2>
          <div className="form-row">
            <div className="form-field form-field--grow">
              <label className="form-label">Podcast Name *</label>
              <input
                type="text"
                className="form-input"
                value={form.podcastName}
                onChange={e => set('podcastName', e.target.value)}
                placeholder="e.g. 硅谷101"
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">Host</label>
              <input
                type="text"
                className="form-input"
                value={form.podcastHost}
                onChange={e => set('podcastHost', e.target.value)}
                placeholder="e.g. Yi Pan"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Category</label>
              <input
                type="text"
                className="form-input"
                value={form.podcastCategory}
                onChange={e => set('podcastCategory', e.target.value)}
                placeholder="e.g. 科技"
              />
            </div>
            <div className="form-field">
              <label className="form-label">Language</label>
              <select className="form-select" value={form.podcastLanguage} onChange={e => set('podcastLanguage', e.target.value)}>
                <option value="zh">中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="es">Español</option>
              </select>
            </div>
          </div>
        </section>

        {/* Episode info */}
        <section className="upload-section">
          <h2 className="upload-section-title">Episode</h2>
          <div className="form-field">
            <label className="form-label">Episode Title *</label>
            <input
              type="text"
              className="form-input"
              value={form.episodeTitle}
              onChange={e => set('episodeTitle', e.target.value)}
              placeholder="e.g. Ep 42: The Future of AI"
              required
            />
          </div>
          <div className="form-field">
            <label className="form-label">Episode URL <span className="form-label-opt">optional</span></label>
            <input
              type="url"
              className="form-input"
              value={form.episodeUrl}
              onChange={e => set('episodeUrl', e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
            />
          </div>
          <div className="form-field">
            <label className="form-label">Description <span className="form-label-opt">optional</span></label>
            <textarea
              className="form-textarea"
              rows={3}
              value={form.episodeDescription}
              onChange={e => set('episodeDescription', e.target.value)}
              placeholder="Brief description of the episode"
            />
          </div>
        </section>

        {/* Transcript */}
        <section className="upload-section">
          <h2 className="upload-section-title">Transcript</h2>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Language</label>
              <select className="form-select" value={form.transcriptLanguage} onChange={e => set('transcriptLanguage', e.target.value)}>
                <option value="zh">中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="es">Español</option>
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Source</label>
              <select className="form-select" value={form.transcriptSource} onChange={e => set('transcriptSource', e.target.value)}>
                <option value="manual">Manual</option>
                <option value="asr">ASR (Auto-generated)</option>
                <option value="ocr">OCR</option>
                <option value="native">Native Subtitles</option>
              </select>
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">Transcript Content *</label>
            <textarea
              className="form-textarea form-textarea--lg"
              rows={14}
              value={form.transcriptContent}
              onChange={e => set('transcriptContent', e.target.value)}
              placeholder="Paste your transcript here…"
              required
            />
          </div>
        </section>

        <div className="upload-footer">
          <p className="upload-notice">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            Transcripts are shared publicly with the community.
          </p>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? (
              <>
                <span className="btn-spinner" />
                Uploading…
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Upload Transcript
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
