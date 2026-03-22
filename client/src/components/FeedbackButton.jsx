import React, { useState } from 'react';
import './FeedbackButton.css';

export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'bug', message: '' });
  const [status, setStatus] = useState(null); // 'sending' | 'sent' | 'error'

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.message.trim()) return;

    setStatus('sending');

    const subject = encodeURIComponent(`[PodScribe 反馈] ${form.type === 'bug' ? '问题报告' : form.type === 'feature' ? '功能建议' : '其他反馈'}`);
    const body = encodeURIComponent(
      `反馈类型: ${form.type === 'bug' ? '问题报告' : form.type === 'feature' ? '功能建议' : '其他'}\n` +
      `来自: ${form.name || '匿名用户'}\n` +
      `页面: ${window.location.href}\n\n` +
      `内容:\n${form.message}`
    );

    window.location.href = `mailto:ericliuof97@gmail.com?subject=${subject}&body=${body}`;

    setStatus('sent');
    setTimeout(() => {
      setOpen(false);
      setStatus(null);
      setForm({ name: '', type: 'bug', message: '' });
    }, 2000);
  };

  return (
    <>
      <button
        className="feedback-fab"
        onClick={() => setOpen(true)}
        title="发送反馈"
        aria-label="发送反馈"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span className="feedback-fab-text">发现问题？告诉我们</span>
      </button>

      {open && (
        <div className="feedback-overlay" onClick={() => setOpen(false)}>
          <div className="feedback-modal" onClick={e => e.stopPropagation()}>
            <div className="feedback-header">
              <h3>反馈与建议</h3>
              <button className="feedback-close" onClick={() => setOpen(false)} aria-label="关闭">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {status === 'sent' ? (
              <div className="feedback-success">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                <p>感谢你的反馈！</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="feedback-form">
                <div className="feedback-field">
                  <label>你的称呼 <span className="feedback-optional">（可选）</span></label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="匿名"
                  />
                </div>

                <div className="feedback-field">
                  <label>反馈类型</label>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                    <option value="bug">问题报告</option>
                    <option value="feature">功能建议</option>
                    <option value="other">其他</option>
                  </select>
                </div>

                <div className="feedback-field">
                  <label>详细描述 <span className="feedback-required">*</span></label>
                  <textarea
                    value={form.message}
                    onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                    placeholder="请描述你遇到的问题或建议..."
                    rows={4}
                    required
                  />
                </div>

                <button type="submit" className="feedback-submit" disabled={status === 'sending'}>
                  {status === 'sending' ? '发送中...' : '发送反馈'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
