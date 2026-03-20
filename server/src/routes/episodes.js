const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// GET /api/episodes/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const episode = db.prepare(`
    SELECT e.*, p.name as podcast_name, p.host as podcast_host,
           p.image_url as podcast_image, p.category as podcast_category,
           CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END as has_transcript
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    LEFT JOIN transcripts t ON t.episode_id = e.id
    WHERE e.id = ?
  `).get(req.params.id);

  if (!episode) return res.status(404).json({ error: 'Episode not found' });
  res.json(episode);
});

// POST /api/episodes
router.post('/', (req, res) => {
  const db = getDb();
  const {
    podcast_id, title, description, published_date, duration,
    audio_url, episode_url, episode_number, season_number, image_url, guests
  } = req.body;

  if (!podcast_id || !title) return res.status(400).json({ error: 'podcast_id and title are required' });

  const podcast = db.prepare('SELECT id FROM podcasts WHERE id = ?').get(podcast_id);
  if (!podcast) return res.status(404).json({ error: 'Podcast not found' });

  const result = db.prepare(`
    INSERT INTO episodes (podcast_id, title, description, published_date, duration, audio_url, episode_url, episode_number, season_number, image_url, guests)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(podcast_id, title, description, published_date, duration, audio_url, episode_url, episode_number, season_number, image_url, guests);

  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(episode);
});

// PUT /api/episodes/:id
router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Episode not found' });

  const {
    title, description, published_date, duration, audio_url,
    episode_url, episode_number, season_number, image_url, guests
  } = req.body;

  db.prepare(`
    UPDATE episodes SET title=?, description=?, published_date=?, duration=?, audio_url=?,
    episode_url=?, episode_number=?, season_number=?, image_url=?, guests=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    title || existing.title, description, published_date, duration, audio_url,
    episode_url, episode_number, season_number, image_url, guests, req.params.id
  );

  const updated = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /api/episodes/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Episode not found' });
  db.prepare('DELETE FROM episodes WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /api/episodes/:id/transcript?lang=zh
// Returns single transcript (for selected lang or best match), plus available_languages list
router.get('/:id/transcript', (req, res) => {
  const db = getDb();
  const episode = db.prepare('SELECT id FROM episodes WHERE id = ?').get(req.params.id);
  if (!episode) return res.status(404).json({ error: 'Episode not found' });

  // Get all transcripts for this episode
  const all = db.prepare('SELECT * FROM transcripts WHERE episode_id = ? ORDER BY created_at ASC').all(req.params.id);
  if (!all.length) return res.status(404).json({ error: 'Transcript not found' });

  const availableLanguages = [...new Set(all.map(t => t.language))];

  let transcript;
  const requestedLang = req.query.lang;
  if (requestedLang) {
    transcript = all.find(t => t.language === requestedLang) || all[0];
  } else {
    // Default: prefer the original language (first inserted / oldest)
    transcript = all[0];
  }

  res.json({ ...transcript, available_languages: availableLanguages });
});

// GET /api/episodes/:id/transcripts — list all language versions
router.get('/:id/transcripts', (req, res) => {
  const db = getDb();
  const episode = db.prepare('SELECT id FROM episodes WHERE id = ?').get(req.params.id);
  if (!episode) return res.status(404).json({ error: 'Episode not found' });

  const transcripts = db.prepare('SELECT id, language, format, source, created_at FROM transcripts WHERE episode_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json({ transcripts });
});

// POST /api/episodes/:id/transcript
// Supports multi-language: if language differs from existing, add instead of replace.
// Pass replace=true to force overwrite same language.
router.post('/:id/transcript', (req, res) => {
  const db = getDb();
  const episode = db.prepare('SELECT id FROM episodes WHERE id = ?').get(req.params.id);
  if (!episode) return res.status(404).json({ error: 'Episode not found' });

  const { content, format, language, source, replace } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });

  const lang = language || 'zh';

  // If replace=true or same language exists, update it; otherwise add new
  const existing = db.prepare('SELECT id FROM transcripts WHERE episode_id = ? AND language = ?').get(req.params.id, lang);
  if (existing && replace !== false) {
    db.prepare('UPDATE transcripts SET content=?, format=?, source=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(content, format || 'plain', source || 'manual', existing.id);
    const transcript = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(existing.id);
    return res.status(200).json(transcript);
  }

  const result = db.prepare(`
    INSERT INTO transcripts (episode_id, content, format, language, source)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.params.id, content, format || 'plain', lang, source || 'manual');

  const transcript = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(transcript);
});

// POST /api/episodes/:id/transcript/polish
// Send transcript to an LLM for post-processing (punctuation + speaker diarization)
// Body: { provider: 'openai'|'anthropic', apiKey, endpoint?, model?, language? }
router.post('/:id/transcript/polish', async (req, res) => {
  const db = getDb();
  const episode = db.prepare('SELECT id FROM episodes WHERE id = ?').get(req.params.id);
  if (!episode) return res.status(404).json({ error: 'Episode not found' });

  const { provider = 'openai', apiKey, endpoint, model, language } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });

  const lang = language || null;
  let transcript;
  if (lang) {
    transcript = db.prepare('SELECT * FROM transcripts WHERE episode_id = ? AND language = ?').get(req.params.id, lang);
  } else {
    transcript = db.prepare('SELECT * FROM transcripts WHERE episode_id = ? ORDER BY created_at ASC LIMIT 1').get(req.params.id);
  }
  if (!transcript) return res.status(404).json({ error: 'Transcript not found' });

  const systemPrompt = `你是一个专业的播客文字稿编辑器。你的任务是将原始的语音转录文本优化为高质量、可读性强的文字稿。

## 输出要求
1. **添加标点符号**：在合适的位置添加逗号、句号、问号、感叹号等中/英文标点
2. **识别说话人**：根据语境、语气、对话模式识别不同说话人，用 **[主持人]** **[嘉宾]** 或真实名字标记
3. **分段**：按说话人轮次分段，每次换人说话另起一行
4. **保留时间戳**：如果输入有时间戳，保留在每段开头
5. **不要改变原意**：不添加、不删除、不改写内容含义
6. **修正明显错误**：修正明显的语音识别错误

只输出处理后的文稿，不要任何解释。`;

  // Process in chunks (~3000 chars each)
  const rawContent = transcript.content;
  const lines = rawContent.split('\n').filter(l => l.trim());
  const CHUNK_SIZE = 3000;
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if (current.length + line.length > CHUNK_SIZE && current.length > 0) {
      chunks.push(current);
      current = '';
    }
    current += (current ? '\n' : '') + line;
  }
  if (current) chunks.push(current);

  try {
    const results = [];
    for (const chunk of chunks) {
      let polished;
      if (provider === 'anthropic') {
        const url = endpoint || 'https://api.anthropic.com/v1/messages';
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: model || 'claude-3-5-haiku-20241022',
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: 'user', content: chunk }]
          })
        });
        if (!resp.ok) throw new Error(`Anthropic API error: ${resp.status}`);
        const data = await resp.json();
        polished = data?.content?.[0]?.text || chunk;
      } else {
        const url = endpoint || 'https://api.openai.com/v1/chat/completions';
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: model || 'gpt-4o-mini',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: chunk }],
            max_tokens: 4096
          })
        });
        if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status}`);
        const data = await resp.json();
        polished = data?.choices?.[0]?.message?.content || chunk;
      }
      results.push(polished);
    }

    const polishedContent = results.join('\n\n');

    // Save as new "polished" version (same language, source=llm_polish)
    const existingPolished = db.prepare('SELECT id FROM transcripts WHERE episode_id = ? AND source = ?').get(req.params.id, 'llm_polish');
    if (existingPolished) {
      db.prepare('UPDATE transcripts SET content=?, format=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(polishedContent, 'plain', existingPolished.id);
    } else {
      db.prepare('INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, ?, ?, ?)').run(
        req.params.id, polishedContent, 'plain', transcript.language, 'llm_polish'
      );
    }

    res.json({ success: true, chunks: chunks.length, originalLength: rawContent.length, polishedLength: polishedContent.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
