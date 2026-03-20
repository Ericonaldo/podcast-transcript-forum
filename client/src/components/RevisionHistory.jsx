import React, { useState, useEffect, useMemo } from 'react';
import { diffLines, toUnifiedHunks, diffStats } from '../utils/diff.js';
import './RevisionHistory.css';

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  if (h < 24) return `${h} 小时前`;
  if (d < 30) return `${d} 天前`;
  return new Date(dateStr).toLocaleDateString('zh-CN');
}

function sourceLabel(source) {
  const map = {
    asr: 'ASR',
    ocr: 'OCR',
    manual: '手动上传',
    community_edit: '社区编辑',
    revert: '回滚',
    native: 'Native',
  };
  return map[source] || source;
}

function sourceColor(source) {
  if (source === 'asr' || source === 'ocr') return 'tag-blue';
  if (source === 'community_edit') return 'tag-purple';
  if (source === 'revert') return 'tag-orange';
  if (source === 'manual') return 'tag-green';
  return 'tag-gray';
}

/** Render a unified diff view between two revision contents */
function DiffPanel({ prev, curr, onClose }) {
  const ops = useMemo(() => diffLines(prev?.content ?? '', curr.content), [prev, curr]);
  const hunks = useMemo(() => toUnifiedHunks(ops, 3), [ops]);
  const stats = useMemo(() => diffStats(ops), [ops]);

  return (
    <div className="rh-diff-panel">
      <div className="rh-diff-topbar">
        <div className="rh-diff-meta">
          <span className="sha-tag">{curr.sha.slice(0, 7)}</span>
          <span className="rh-diff-msg">{curr.message}</span>
          {prev ? (
            <span className="rh-diff-stats">
              <span className="diff-add">+{stats.added}</span>
              <span className="diff-remove">−{stats.removed}</span>
            </span>
          ) : <span className="rh-diff-stats">初始版本</span>}
        </div>
        <button className="rh-diff-close" onClick={onClose} aria-label="关闭">×</button>
      </div>

      <div className="te-diff-view rh-diff-view">
        {!prev ? (
          /* First commit — show full content as additions */
          curr.content.split('\n').map((line, i) => (
            <div key={i} className="diff-line diff-line--add">
              <span className="diff-gutter"><span></span><span>{i + 1}</span></span>
              <span className="diff-sign">+</span>
              <span className="diff-text">{line || '\u00a0'}</span>
            </div>
          ))
        ) : hunks.length === 0 ? (
          <div className="te-no-diff">内容无变化</div>
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
    </div>
  );
}

export default function RevisionHistory({ episodeId, onRestore }) {
  const [revisions, setRevisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [diffTarget, setDiffTarget] = useState(null); // { rev, prevRev }
  const [restoring, setRestoring] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/episodes/${episodeId}/revisions`)
      .then(r => r.json())
      .then(data => {
        setRevisions(Array.isArray(data) ? data : []);
      })
      .catch(() => setError('加载历史失败'))
      .finally(() => setLoading(false));
  }, [episodeId]);

  async function handleRestore(rev) {
    if (!window.confirm(`确定要回滚到 ${rev.sha.slice(0, 7)}: "${rev.message}" 吗？\n这将创建一个新的回滚提交。`)) return;
    setRestoring(rev.id);
    setError('');
    try {
      const res = await fetch(`/api/episodes/${episodeId}/revisions/${rev.sha}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: 'Anonymous' }),
      });
      if (!res.ok) throw new Error('回滚失败');
      const newRev = await res.json();
      setRevisions(prev => [newRev, ...prev]);
      onRestore?.(newRev);
    } catch (err) {
      setError(err.message);
    } finally {
      setRestoring(null);
    }
  }

  async function showDiff(rev) {
    // Fetch full content if not already loaded
    let fullRev = rev;
    if (!rev.content) {
      const r = await fetch(`/api/episodes/${episodeId}/revisions/${rev.sha}`);
      fullRev = await r.json();
    }
    // Find parent revision (next in sorted list = older)
    const idx = revisions.findIndex(r => r.id === rev.id);
    const parentRev = revisions[idx + 1] ?? null;
    let fullParent = parentRev;
    if (parentRev && !parentRev.content) {
      const r = await fetch(`/api/episodes/${episodeId}/revisions/${parentRev.sha}`);
      fullParent = await r.json();
    }
    setDiffTarget({ rev: fullRev, prevRev: fullParent });
  }

  if (loading) return <div className="rh-loading">加载历史记录…</div>;

  return (
    <div className="rh-root">
      <div className="rh-header">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/>
        </svg>
        <span className="rh-title">修改历史</span>
        <span className="rh-count">{revisions.length} 次提交</span>
      </div>

      {error && <div className="rh-error">{error}</div>}

      {revisions.length === 0 ? (
        <div className="rh-empty">暂无修改历史</div>
      ) : (
        <>
          {/* Show diff panel if selected */}
          {diffTarget && (
            <DiffPanel
              prev={diffTarget.prevRev}
              curr={diffTarget.rev}
              onClose={() => setDiffTarget(null)}
            />
          )}

          <div className="rh-log">
            {revisions.map((rev, idx) => (
              <div key={rev.id} className={`rh-entry ${diffTarget?.rev?.id === rev.id ? 'rh-entry--active' : ''}`}>
                {/* Graph line */}
                <div className="rh-graph">
                  <div className="rh-graph-dot" />
                  {idx < revisions.length - 1 && <div className="rh-graph-line" />}
                </div>

                <div className="rh-entry-body">
                  <div className="rh-entry-top">
                    <code
                      className="sha-tag sha-tag--clickable"
                      onClick={() => showDiff(rev)}
                      title="查看此次变更"
                    >
                      {rev.sha.slice(0, 7)}
                    </code>
                    <span className="rh-msg">{rev.message}</span>
                    <span className={`rh-source-tag ${sourceColor(rev.source)}`}>
                      {sourceLabel(rev.source)}
                    </span>
                  </div>
                  <div className="rh-entry-meta">
                    <span className="rh-author">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                      </svg>
                      {rev.author}
                    </span>
                    <span className="rh-time" title={rev.created_at}>{timeAgo(rev.created_at)}</span>
                    {rev.content_length && (
                      <span className="rh-size">{(rev.content_length / 1000).toFixed(1)} KB</span>
                    )}
                  </div>
                </div>

                <div className="rh-entry-actions">
                  <button
                    className="rh-btn-diff"
                    onClick={() => showDiff(rev)}
                    title="查看变更"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
                    </svg>
                    diff
                  </button>
                  {idx > 0 && (
                    <button
                      className="rh-btn-restore"
                      onClick={() => handleRestore(rev)}
                      disabled={restoring === rev.id}
                      title="回滚到此版本"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/>
                      </svg>
                      {restoring === rev.id ? '回滚中…' : 'restore'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
