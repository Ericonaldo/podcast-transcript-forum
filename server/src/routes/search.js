const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// Build a safe FTS5 query string
function buildFtsQuery(term) {
  // Remove FTS5 special chars, wrap in quotes for phrase search
  const clean = term.replace(/["*^()]/g, ' ').trim();
  if (!clean) return null;
  // Try phrase match, fall back to token match
  return '"' + clean + '"';
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

  if (!ftsQuery) {
    return res.status(400).json({ error: 'Invalid search query' });
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
    // FTS query may fail for invalid patterns - fall back to LIKE search
    console.error('FTS search failed, falling back to LIKE search:', err.message);
    const likePattern = `%${searchTerm}%`;

    if (type === 'all' || type === 'podcast') {
      results.podcasts = db.prepare(`
        SELECT p.*, p.name as name_snippet, p.host as host_snippet,
               COUNT(DISTINCT e.id) as episode_count, COUNT(DISTINCT t.id) as transcript_count
        FROM podcasts p
        LEFT JOIN episodes e ON e.podcast_id = p.id
        LEFT JOIN transcripts t ON t.episode_id = e.id
        WHERE p.name LIKE ? OR p.host LIKE ? OR p.description LIKE ?
        GROUP BY p.id
        ORDER BY p.name
        LIMIT ? OFFSET ?
      `).all(likePattern, likePattern, likePattern, parseInt(limit), offset);
    }

    if (type === 'all' || type === 'episode') {
      results.episodes = db.prepare(`
        SELECT e.*, p.name as podcast_name, p.host as podcast_host, p.category as podcast_category,
               e.title as title_snippet, e.description as description_snippet, e.guests as guests_snippet,
               CASE WHEN tr.id IS NOT NULL THEN 1 ELSE 0 END as has_transcript
        FROM episodes e
        JOIN podcasts p ON p.id = e.podcast_id
        LEFT JOIN transcripts tr ON tr.episode_id = e.id
        WHERE e.title LIKE ? OR e.description LIKE ? OR e.guests LIKE ?
        ORDER BY e.published_date DESC
        LIMIT ? OFFSET ?
      `).all(likePattern, likePattern, likePattern, parseInt(limit), offset);
    }

    if (type === 'all' || type === 'transcript') {
      results.transcripts = db.prepare(`
        SELECT t.*, e.title as episode_title, e.audio_url, e.episode_url,
               p.id as podcast_id, p.name as podcast_name, p.host as podcast_host, p.category as podcast_category,
               SUBSTR(t.content, MAX(1, INSTR(t.content, ?) - 50), 200) as content_snippet
        FROM transcripts t
        JOIN episodes e ON e.id = t.episode_id
        JOIN podcasts p ON p.id = e.podcast_id
        WHERE t.content LIKE ?
        ORDER BY t.created_at DESC
        LIMIT ? OFFSET ?
      `).all(searchTerm, likePattern, parseInt(limit), offset);
    }
  }

  const total = (results.podcasts?.length || 0) + (results.episodes?.length || 0) + (results.transcripts?.length || 0);
  res.json({ query: q, type, results, pagination: { page: parseInt(page), limit: parseInt(limit) }, total });
});

module.exports = router;
