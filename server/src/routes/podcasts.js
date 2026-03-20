const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// GET /api/podcasts - list all podcasts
router.get('/', (req, res) => {
  const db = getDb();
  const { category, page = 1, limit = 20, sort = 'name' } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const validSorts = { name: 'name', created: 'created_at', episodes: 'episode_count' };
  const sortCol = validSorts[sort] || 'name';

  let whereClause = '';
  const params = [];
  if (category) {
    whereClause = 'WHERE p.category = ?';
    params.push(category);
  }

  const total = db.prepare(`
    SELECT COUNT(*) as count FROM podcasts p ${whereClause}
  `).get(...params).count;

  let orderBy = `p.${sortCol}`;
  if (sort === 'episodes') {
    orderBy = 'episode_count DESC';
  }

  const rows = db.prepare(`
    SELECT p.*, COUNT(DISTINCT e.id) as episode_count,
           COUNT(DISTINCT CASE WHEN t.id IS NOT NULL THEN e.id END) as transcript_count
    FROM podcasts p
    LEFT JOIN episodes e ON e.podcast_id = p.id
    LEFT JOIN transcripts t ON t.episode_id = e.id
    ${whereClause}
    GROUP BY p.id
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({
    data: rows,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit))
    }
  });
});

// GET /api/podcasts/categories - get all categories
router.get('/categories', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT category, COUNT(*) as count
    FROM podcasts
    WHERE category IS NOT NULL
    GROUP BY category
    ORDER BY count DESC
  `).all();
  res.json(rows);
});

// GET /api/podcasts/:id - get single podcast
router.get('/:id', (req, res) => {
  const db = getDb();
  const podcast = db.prepare(`
    SELECT p.*, COUNT(DISTINCT e.id) as episode_count,
           COUNT(DISTINCT t.id) as transcript_count
    FROM podcasts p
    LEFT JOIN episodes e ON e.podcast_id = p.id
    LEFT JOIN transcripts t ON t.episode_id = e.id
    WHERE p.id = ?
    GROUP BY p.id
  `).get(req.params.id);

  if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
  res.json(podcast);
});

// POST /api/podcasts - create podcast
router.post('/', (req, res) => {
  const db = getDb();
  const { name, host, description, category, image_url, website_url, rss_url, language } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const stmt = db.prepare(`
    INSERT INTO podcasts (name, host, description, category, image_url, website_url, rss_url, language)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(name, host, description, category, image_url, website_url, rss_url, language || 'zh');
  const podcast = db.prepare('SELECT * FROM podcasts WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(podcast);
});

// PUT /api/podcasts/:id - update podcast
router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, host, description, category, image_url, website_url, rss_url, language } = req.body;
  const existing = db.prepare('SELECT * FROM podcasts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Podcast not found' });

  db.prepare(`
    UPDATE podcasts SET name=?, host=?, description=?, category=?, image_url=?, website_url=?, rss_url=?, language=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(name || existing.name, host, description, category, image_url, website_url, rss_url, language || existing.language, req.params.id);

  const updated = db.prepare('SELECT * FROM podcasts WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /api/podcasts/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM podcasts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Podcast not found' });
  db.prepare('DELETE FROM podcasts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /api/podcasts/:id/episodes
router.get('/:id/episodes', (req, res) => {
  const db = getDb();
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const podcast = db.prepare('SELECT id FROM podcasts WHERE id = ?').get(req.params.id);
  if (!podcast) return res.status(404).json({ error: 'Podcast not found' });

  const total = db.prepare('SELECT COUNT(*) as count FROM episodes WHERE podcast_id = ?').get(req.params.id).count;
  const episodes = db.prepare(`
    SELECT e.*,
           CASE WHEN EXISTS(SELECT 1 FROM transcripts t WHERE t.episode_id = e.id) THEN 1 ELSE 0 END as has_transcript
    FROM episodes e
    WHERE e.podcast_id = ?
    ORDER BY e.published_date DESC, e.id DESC
    LIMIT ? OFFSET ?
  `).all(req.params.id, parseInt(limit), offset);

  res.json({
    data: episodes,
    pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
  });
});

module.exports = router;
