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

// GET /api/episodes/:id/transcript
router.get('/:id/transcript', (req, res) => {
  const db = getDb();
  const episode = db.prepare('SELECT id FROM episodes WHERE id = ?').get(req.params.id);
  if (!episode) return res.status(404).json({ error: 'Episode not found' });

  const transcript = db.prepare('SELECT * FROM transcripts WHERE episode_id = ? ORDER BY created_at DESC LIMIT 1').get(req.params.id);
  if (!transcript) return res.status(404).json({ error: 'Transcript not found' });
  res.json(transcript);
});

// POST /api/episodes/:id/transcript
router.post('/:id/transcript', (req, res) => {
  const db = getDb();
  const episode = db.prepare('SELECT id FROM episodes WHERE id = ?').get(req.params.id);
  if (!episode) return res.status(404).json({ error: 'Episode not found' });

  const { content, format, language, source } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });

  // Delete existing transcript for this episode and replace
  db.prepare('DELETE FROM transcripts WHERE episode_id = ?').run(req.params.id);

  const result = db.prepare(`
    INSERT INTO transcripts (episode_id, content, format, language, source)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.params.id, content, format || 'plain', language || 'zh', source || 'manual');

  const transcript = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(transcript);
});

module.exports = router;
