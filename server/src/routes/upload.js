const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

/**
 * GET /api/check?url=<episode_url>
 * Check if a transcript already exists for the given episode/audio URL.
 * Used by the EchoShell extension to avoid duplicates.
 */
router.get('/check', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter required' });

  const db = getDb();
  const episode = db.prepare(`
    SELECT e.id, e.podcast_id, e.title, p.name as podcast_name
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    JOIN transcripts t ON t.episode_id = e.id
    WHERE e.episode_url = ? OR e.audio_url = ?
    ORDER BY t.created_at DESC
    LIMIT 1
  `).get(url, url);

  if (!episode) return res.json({ found: false });

  res.json({
    found: true,
    episodeId: episode.id,
    podcastId: episode.podcast_id,
    episodeTitle: episode.title,
    podcastName: episode.podcast_name
  });
});

/**
 * POST /api/upload
 * Anonymous batch upload: creates podcast + episode + transcript in one shot.
 * No authentication required.
 * Body: { podcast: { name, host?, category?, description?, language? },
 *         episode: { title, audio_url?, episode_url?, description?, duration?, published_date?, guests? },
 *         transcript: { content, format?, language?, source? } }
 */
router.post('/upload', (req, res) => {
  const { podcast, episode, transcript } = req.body;

  if (!podcast || !podcast.name) return res.status(400).json({ error: 'podcast.name is required' });
  if (!episode || !episode.title) return res.status(400).json({ error: 'episode.title is required' });
  if (!transcript || !transcript.content) return res.status(400).json({ error: 'transcript.content is required' });

  const db = getDb();

  // Find or create podcast by name (case-insensitive match)
  let podcastRecord = db.prepare(
    'SELECT id FROM podcasts WHERE LOWER(name) = LOWER(?) LIMIT 1'
  ).get(podcast.name);

  if (!podcastRecord) {
    const r = db.prepare(`
      INSERT INTO podcasts (name, host, description, category, language)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      podcast.name,
      podcast.host || null,
      podcast.description || null,
      podcast.category || null,
      podcast.language || 'zh'
    );
    podcastRecord = { id: r.lastInsertRowid };
  }

  // Check for duplicate episode by URL within this podcast
  let episodeRecord = null;
  const episodeUrl = episode.episode_url || null;
  const audioUrl = episode.audio_url || null;

  if (episodeUrl || audioUrl) {
    episodeRecord = db.prepare(`
      SELECT id FROM episodes
      WHERE podcast_id = ? AND (
        (episode_url IS NOT NULL AND episode_url = ?) OR
        (audio_url IS NOT NULL AND audio_url = ?)
      )
      LIMIT 1
    `).get(podcastRecord.id, episodeUrl || '', audioUrl || '');
  }

  if (!episodeRecord) {
    const r = db.prepare(`
      INSERT INTO episodes (podcast_id, title, description, duration, audio_url, episode_url, published_date, guests)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      podcastRecord.id,
      episode.title,
      episode.description || null,
      episode.duration || null,
      audioUrl,
      episodeUrl,
      episode.published_date || null,
      episode.guests || null
    );
    episodeRecord = { id: r.lastInsertRowid };
  }

  // Replace existing transcript for this episode
  db.prepare('DELETE FROM transcripts WHERE episode_id = ?').run(episodeRecord.id);

  const r = db.prepare(`
    INSERT INTO transcripts (episode_id, content, format, language, source)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    episodeRecord.id,
    transcript.content,
    transcript.format || 'plain',
    transcript.language || 'zh',
    transcript.source || 'asr'
  );

  res.status(201).json({
    success: true,
    episodeId: episodeRecord.id,
    podcastId: podcastRecord.id,
    transcriptId: r.lastInsertRowid
  });
});

module.exports = router;
