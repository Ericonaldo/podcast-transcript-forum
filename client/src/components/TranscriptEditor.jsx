import React, { useState, useMemo } from 'react';
import { diffLines, toUnifiedHunks, diffStats } from '../utils/diff.js';
import './TranscriptEditor.css';

/**
 * Inline transcript editor with:
 * - Step 1: edit textarea
 * - Step 2: git-diff-like preview + commit message
 * - Step 3: success confirmation
 */
export default function TranscriptEditor({ episodeId, originalContent, onCancel, onSuccess }) {
  const [step, setStep] = useState('edit'); // 'edit' | 'preview' | 'done'
  const [edited, setEdited] = useState(originalContent);
  const [message, setMessage] = useState('');
  const [author, setAuthor] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const ops = useMemo(() => diffLines(originalContent, edited), [originalContent, edited]);
  const hunks = useMemo(() => toUnifiedHunks(ops, 3), [ops]);
  const stats = useMemo(() => diffStats(ops), [ops]);

  async function handleSubmit() {
    if (!stats.changed) return setError('文字稿内容未更改');
    if (!message.trim()) return setError('请填写本次修改说明（即提交信息）');
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/revisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: edited,
          message: message.trim(),
          author: author.trim() || 'Anonymous',
          source: 'community_edit'
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || '提交失败');
      }
      const data = await res.json();
      setResult(data);
      setStep('done');
      onSuccess(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'done') {
    return (
      <div className="te-done">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/>
        </svg>
        <h3>修改已提交</h3>
        <p className="te-done-sha">
          <span className="sha-tag">{result?.sha?.slice(0, 7)}</span>
          {result?.message}
        </p>
        <button className="btn-ghost-sm" onClick={onCancel}>关闭</button>
      </div>
    );
  }

  return (
    <div className="te-root">
      {/* Step tabs */}
      <div className="te-steps">
        <button
          className={`te-step-btn ${step === 'edit' ? 'te-step-btn--active' : ''}`}
          onClick={() => setStep('edit')}
        >
          <span className="te-step-num">1</span> 编辑
        </button>
        <span className="te-step-arrow">›</span>
        <button
          className={`te-step-btn ${step === 'preview' ? 'te-step-btn--active' : ''}`}
          onClick={() => stats.changed && setStep('preview')}
          disabled={!stats.changed}
        >
          <span className="te-step-num">2</span> 审阅变更
        </button>
        <span className="te-step-arrow">›</span>
        <span className="te-step-btn te-step-btn--disabled">
          <span className="te-step-num">3</span> 提交
        </span>
      </div>

      {/* Step 1: edit */}
      {step === 'edit' && (
        <div className="te-edit-panel">
          <div className="te-edit-toolbar">
            <span className="te-edit-hint">直接修改下方文字稿内容</span>
            {stats.changed && (
              <span className="te-diff-badge">
                <span className="diff-add">+{stats.added}</span>
                <span className="diff-remove">−{stats.removed}</span>
                行
              </span>
            )}
          </div>
          <textarea
            className="te-textarea"
            value={edited}
            onChange={e => setEdited(e.target.value)}
            spellCheck={false}
            autoFocus
          />
          <div className="te-edit-footer">
            <button className="btn-ghost-sm" onClick={onCancel}>取消</button>
            <button
              className="btn-primary-sm"
              onClick={() => setStep('preview')}
              disabled={!stats.changed}
            >
              预览变更 →
            </button>
          </div>
        </div>
      )}

      {/* Step 2: diff preview + commit */}
      {step === 'preview' && (
        <div className="te-preview-panel">
          <div className="te-diff-header">
            <span className="te-diff-filename">transcript.txt</span>
            <span className="te-diff-stats">
              <span className="diff-add">+{stats.added}</span>
              <span className="diff-remove">−{stats.removed}</span>
            </span>
          </div>

          <div className="te-diff-view">
            {hunks.length === 0 ? (
              <div className="te-no-diff">无变更</div>
            ) : (
              hunks.map((hunk, hi) => (
                <div key={hi} className="diff-hunk">
                  <div className="diff-hunk-header">{hunk.header}</div>
                  {hunk.lines.map((line, li) => (
                    <div key={li} className={`diff-line diff-line--${line.type}`}>
                      <span className="diff-gutter">
                        {line.type === 'same' && <><span>{line.lineA}</span><span>{line.lineB}</span></>}
                        {line.type === 'remove' && <><span>{line.lineA}</span><span></span></>}
                        {line.type === 'add' && <><span></span><span>{line.lineB}</span></>}
                      </span>
                      <span className="diff-sign">
                        {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}
                      </span>
                      <span className="diff-text">{line.text || '\u00a0'}</span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>

          {/* Commit message box */}
          <div className="te-commit-box">
            <div className="te-commit-label">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/>
              </svg>
              提交信息
            </div>
            <input
              type="text"
              className="te-commit-msg"
              placeholder="描述本次修改，例如：修正第3段错别字"
              value={message}
              onChange={e => setMessage(e.target.value)}
              autoFocus
              maxLength={200}
            />
            <input
              type="text"
              className="te-commit-author"
              placeholder="署名（可选，默认 Anonymous）"
              value={author}
              onChange={e => setAuthor(e.target.value)}
              maxLength={60}
            />
            {error && <div className="te-error">{error}</div>}
          </div>

          <div className="te-preview-footer">
            <button className="btn-ghost-sm" onClick={() => setStep('edit')}>← 返回编辑</button>
            <button
              className="btn-commit"
              onClick={handleSubmit}
              disabled={submitting || !message.trim()}
            >
              {submitting ? '提交中…' : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/>
                  </svg>
                  Commit changes
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
