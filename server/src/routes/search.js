const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// Build a safe FTS5 query string for trigram tokenizer
function buildFtsQuery(term) {
  // Trigram tokenizer doesn't use phrase quotes or special operators
  // Requires minimum 3 characters
  const clean = term.replace(/["*^()]/g, ' ').trim();
  if (!clean) return null;
  // Check if we have any substring >= 3 chars (for CJK, each char counts separately in trigram)
  // Trigram works by creating 3-char sequences, so min input is 3 chars
  if ([...clean].length < 3) return null; // Use null to signal fall back to LIKE
  return clean;
}

// GET /api/search?q=query&type=all|podcast|episode|transcript&category=&page=1&limit=20
router.get('/', (req, res) => {
  const db = getDb();
  const { q, type = 'all', category, page = 1, limit = 20 } = req.query;

  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const searchTerm = q.trim();
  const ftsQuery = buildFtsQuery(searchTerm);

  // Short queries (< 3 chars) can't use trigram FTS - go straight to LIKE
  if (!ftsQuery) {
    return likeSearch(db, res, searchTerm, type, category, q, parseInt(page), parseInt(limit), offset);
  }

  const results = {};

  try {
    if (type === 'all' || type === 'podcast') {
      const catFilter = category ? 'AND p.category = ?' : '';
      const catParams = category ? [category] : [];

      results.podcasts = db.prepare(`
        SELECT p.*, snippet(podcasts_fts, 0, '<mark>', '</mark>', '...', 20) as name_snippet,
               snippet(podcasts_fts, 1, '<mark>', '</mark>', '...', 20) as host_snippet,
               COUNT(DISTINCT e.id) as episode_count,
               COUNT(DISTINCT t.id) as transcript_count
        FROM podcasts_fts
        JOIN podcasts p ON p.id = podcasts_fts.rowid
        LEFT JOIN episodes e ON e.podcast_id = p.id
        LEFT JOIN transcripts t ON t.episode_id = e.id
        WHERE podcasts_fts MATCH ?
        ${catFilter}
        GROUP BY p.id
        ORDER BY rank
        LIMIT ? OFFSET ?
      `).all(ftsQuery, ...catParams, parseInt(limit), offset);
    }

    if (type === 'all' || type === 'episode') {
      const catJoin = category ? 'JOIN podcasts p2 ON p2.id = e.podcast_id' : '';
      const catFilter = category ? 'AND p2.category = ?' : '';
      const catParams = category ? [category] : [];

      results.episodes = db.prepare(`
        SELECT e.*,
               p.name as podcast_name, p.host as podcast_host, p.category as podcast_category,
               snippet(episodes_fts, 0, '<mark>', '</mark>', '...', 20) as title_snippet,
               snippet(episodes_fts, 1, '<mark>', '</mark>', '...', 30) as description_snippet,
               snippet(episodes_fts, 2, '<mark>', '</mark>', '...', 20) as guests_snippet,
               CASE WHEN tr.id IS NOT NULL THEN 1 ELSE 0 END as has_transcript
        FROM episodes_fts
        JOIN episodes e ON e.id = episodes_fts.rowid
        JOIN podcasts p ON p.id = e.podcast_id
        ${catJoin}
        LEFT JOIN transcripts tr ON tr.episode_id = e.id
        WHERE episodes_fts MATCH ?
        ${catFilter}
        ORDER BY rank
        LIMIT ? OFFSET ?
      `).all(ftsQuery, ...catParams, parseInt(limit), offset);
    }

    if (type === 'all' || type === 'transcript') {
      const catJoin = category ? 'JOIN podcasts p2 ON p2.id = e.podcast_id' : '';
      const catFilter = category ? 'AND p2.category = ?' : '';
      const catParams = category ? [category] : [];

      results.transcripts = db.prepare(`
        SELECT t.*,
               e.title as episode_title, e.audio_url, e.episode_url,
               p.id as podcast_id, p.name as podcast_name, p.host as podcast_host, p.category as podcast_category,
               snippet(transcripts_fts, 0, '<mark>', '</mark>', '...', 40) as content_snippet
        FROM transcripts_fts
        JOIN transcripts t ON t.id = transcripts_fts.rowid
        JOIN episodes e ON e.id = t.episode_id
        JOIN podcasts p ON p.id = e.podcast_id
        ${catJoin}
        WHERE transcripts_fts MATCH ?
        ${catFilter}
        ORDER BY rank
        LIMIT ? OFFSET ?
      `).all(ftsQuery, ...catParams, parseInt(limit), offset);
    }
  } catch (err) {
    // FTS query failed - fall back to LIKE search
    console.error('FTS search failed, falling back to LIKE:', err.message);
    return likeSearch(db, res, searchTerm, type, category, q, parseInt(page), parseInt(limit), offset);
  }

  // If FTS returned 0 total results, also try LIKE fallback
  const ftsTotal = (results.podcasts?.length || 0) + (results.episodes?.length || 0) + (results.transcripts?.length || 0);
  if (ftsTotal === 0) {
    return likeSearch(db, res, searchTerm, type, category, q, parseInt(page), parseInt(limit), offset);
  }

  const total = ftsTotal;
  res.json({ query: q, type, results, pagination: { page: parseInt(page), limit: parseInt(limit) }, total });
});

function likeSearch(db, res, searchTerm, type, category, originalQuery, page, limit, offset) {
  const likePattern = `%${searchTerm}%`;
  const results = {};

  if (type === 'all' || type === 'podcast') {
    const catFilter = category ? 'AND p.category = ?' : '';
    const catParams = category ? [category] : [];
    results.podcasts = db.prepare(`
      SELECT p.*, p.name as name_snippet, p.host as host_snippet,
             COUNT(DISTINCT e.id) as episode_count, COUNT(DISTINCT t.id) as transcript_count
      FROM podcasts p
      LEFT JOIN episodes e ON e.podcast_id = p.id
      LEFT JOIN transcripts t ON t.episode_id = e.id
      WHERE (p.name LIKE ? OR p.host LIKE ? OR p.description LIKE ?)
      ${catFilter}
      GROUP BY p.id
      ORDER BY p.name
      LIMIT ? OFFSET ?
    `).all(likePattern, likePattern, likePattern, ...catParams, limit, offset);
  }

  if (type === 'all' || type === 'episode') {
    const catJoin = category ? 'JOIN podcasts p2 ON p2.id = e.podcast_id' : '';
    const catFilter = category ? 'AND p2.category = ?' : '';
    const catParams = category ? [category] : [];
    results.episodes = db.prepare(`
      SELECT e.*, p.name as podcast_name, p.host as podcast_host, p.category as podcast_category,
             e.title as title_snippet, e.description as description_snippet, e.guests as guests_snippet,
             CASE WHEN tr.id IS NOT NULL THEN 1 ELSE 0 END as has_transcript
      FROM episodes e
      JOIN podcasts p ON p.id = e.podcast_id
      ${catJoin}
      LEFT JOIN transcripts tr ON tr.episode_id = e.id
      WHERE (e.title LIKE ? OR e.description LIKE ? OR e.guests LIKE ?)
      ${catFilter}
      ORDER BY e.published_date DESC
      LIMIT ? OFFSET ?
    `).all(likePattern, likePattern, likePattern, ...catParams, limit, offset);
  }

  if (type === 'all' || type === 'transcript') {
    const catJoin = category ? 'JOIN podcasts p2 ON p2.id = e.podcast_id' : '';
    const catFilter = category ? 'AND p2.category = ?' : '';
    const catParams = category ? [category] : [];
    results.transcripts = db.prepare(`
      SELECT t.*, e.title as episode_title, e.audio_url, e.episode_url,
             p.id as podcast_id, p.name as podcast_name, p.host as podcast_host, p.category as podcast_category,
             SUBSTR(t.content, MAX(1, INSTR(t.content, ?) - 50), 200) as content_snippet
      FROM transcripts t
      JOIN episodes e ON e.id = t.episode_id
      JOIN podcasts p ON p.id = e.podcast_id
      ${catJoin}
      WHERE t.content LIKE ?
      ${catFilter}
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `).all(searchTerm, likePattern, ...catParams, limit, offset);
  }

  const total = (results.podcasts?.length || 0) + (results.episodes?.length || 0) + (results.transcripts?.length || 0);
  res.json({ query: originalQuery, type, results, pagination: { page, limit }, total });
}

module.exports = router;
