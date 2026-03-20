import React, { useState } from 'react';
import './ContributeModal.css';

export default function ContributeModal({ episode, onClose, onSuccess }) {
  const [tab, setTab] = useState('plugin'); // 'plugin' | 'upload'
  const [content, setContent] = useState('');
  const [language, setLanguage] = useState('zh');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleUpload(e) {
    e.preventDefault();
    if (!content.trim()) return setError('请填写文字稿内容');
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`/api/episodes/${episode.id}/transcript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim(), language, source: 'manual' }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || '上传失败');
      }
      const data = await res.json();
      onSuccess(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const episodeLink = episode.episode_url || episode.audio_url;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box contribute-modal">
        <div className="modal-header">
          <div className="modal-title-group">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            <h2 className="modal-title">我来贡献文字稿</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="modal-episode-name">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>
          </svg>
          {episode.title}
        </div>

        {/* Tabs */}
        <div className="modal-tabs">
          <button
            className={`modal-tab ${tab === 'plugin' ? 'modal-tab--active' : ''}`}
            onClick={() => setTab('plugin')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
            用插件获取
          </button>
          <button
            className={`modal-tab ${tab === 'upload' ? 'modal-tab--active' : ''}`}
            onClick={() => setTab('upload')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            直接上传
          </button>
        </div>

        {/* Plugin guide tab */}
        {tab === 'plugin' && (
          <div className="plugin-guide">
            <p className="plugin-guide-intro">
              使用 <strong>EchoShell</strong> 浏览器插件，可以一键从音频/视频网站获取文字稿并自动上传到社区。
            </p>

            <ol className="plugin-steps">
              <li className="plugin-step">
                <div className="step-num">1</div>
                <div className="step-body">
                  <div className="step-title">安装 EchoShell 插件</div>
                  <div className="step-desc">在 Chrome 应用商店搜索 <code>EchoShell</code> 并安装，或从 GitHub 加载未打包的扩展。</div>
                </div>
              </li>
              <li className="plugin-step">
                <div className="step-num">2</div>
                <div className="step-body">
                  <div className="step-title">配置插件</div>
                  <div className="step-desc">在插件设置中填写 ASR API Key（支持 OpenAI Whisper / Deepgram / Groq），并在「Forum」标签下填写本站地址并开启自动上传。</div>
                </div>
              </li>
              <li className="plugin-step">
                <div className="step-num">3</div>
                <div className="step-body">
                  <div className="step-title">前往该节目页面</div>
                  <div className="step-desc">
                    打开播客原链接，在网站播放音频。
                    {episodeLink && (
                      <a href={episodeLink} target="_blank" rel="noopener noreferrer" className="step-link">
                        打开节目链接 →
                      </a>
                    )}
                  </div>
                </div>
              </li>
              <li className="plugin-step">
                <div className="step-num">4</div>
                <div className="step-body">
                  <div className="step-title">启动转译</div>
                  <div className="step-desc">点击 EchoShell 图标 → 「Start Transcript」。插件会先检查本站是否已有文字稿。若无，则自动转译并上传到本站。</div>
                </div>
              </li>
              <li className="plugin-step step--highlight">
                <div className="step-num">✓</div>
                <div className="step-body">
                  <div className="step-title">自动上传完成</div>
                  <div className="step-desc">转译完成后，文字稿将自动出现在本页面，侧边栏也会弹出确认提示。</div>
                </div>
              </li>
            </ol>

            <div className="plugin-note">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              也可以切换到「直接上传」手动粘贴文字稿。
            </div>
          </div>
        )}

        {/* Direct upload tab */}
        {tab === 'upload' && (
          <form className="upload-form-simple" onSubmit={handleUpload}>
            {error && <div className="modal-error">{error}</div>}

            <div className="form-field-inline">
              <label className="form-label">语言</label>
              <select className="form-select-sm" value={language} onChange={e => setLanguage(e.target.value)}>
                <option value="zh">中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
              </select>
            </div>

            <textarea
              className="contribute-textarea"
              placeholder="在这里粘贴文字稿内容…&#10;&#10;支持纯文本、带时间戳格式 [0:00] 文字、SRT、VTT 等格式。"
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={12}
              autoFocus
            />

            <div className="modal-footer">
              <span className="char-count">{content.length.toLocaleString()} 字符</span>
              <div className="modal-actions">
                <button type="button" className="btn-ghost-sm" onClick={onClose}>取消</button>
                <button type="submit" className="btn-primary-sm" disabled={submitting || !content.trim()}>
                  {submitting ? '上传中…' : '提交文字稿'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
