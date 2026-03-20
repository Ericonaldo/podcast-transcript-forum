const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDb } = require('../db');

function makeSha(content, timestamp) {
  return crypto.createHash('sha1').update(content + timestamp).digest('hex').slice(0, 40);
}

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
    WHERE e.episode_url = ? OR e.audio_url = ?
    LIMIT 1
  `).get(url, url);

  if (!episode) return res.json({ found: false });

  const transcripts = db.prepare('SELECT language, source FROM transcripts WHERE episode_id = ?').all(episode.id);

  res.json({
    found: transcripts.length > 0,
    episodeId: episode.id,
    podcastId: episode.podcast_id,
    episodeTitle: episode.title,
    podcastName: episode.podcast_name,
    available_languages: transcripts.map(t => t.language)
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

  // Multi-language support: if same language exists, update; otherwise add new
  const lang = transcript.language || 'zh';
  const source = transcript.source || 'asr';
  const now = new Date().toISOString();
  const sha = makeSha(transcript.content, now);

  const existingTr = db.prepare('SELECT id FROM transcripts WHERE episode_id = ? AND language = ?').get(episodeRecord.id, lang);

  const result = db.transaction(() => {
    let transcriptId;
    if (existingTr) {
      db.prepare('UPDATE transcripts SET content=?, format=?, source=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(
        transcript.content, transcript.format || 'plain', source, existingTr.id);
      transcriptId = existingTr.id;
    } else {
      const r = db.prepare(`
        INSERT INTO transcripts (episode_id, content, format, language, source)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        episodeRecord.id,
        transcript.content,
        transcript.format || 'plain',
        lang,
        source
      );
      transcriptId = r.lastInsertRowid;
    }

    // Seed revision history with initial upload
    db.prepare(`
      INSERT INTO transcript_revisions (episode_id, content, message, author, source, parent_id, sha)
      VALUES (?, ?, ?, ?, ?, NULL, ?)
    `).run(
      episodeRecord.id,
      transcript.content,
      transcript.message || '初始上传',
      transcript.author || 'Anonymous',
      source,
      sha
    );

    return transcriptId;
  })();

  res.status(201).json({
    success: true,
    episodeId: episodeRecord.id,
    podcastId: podcastRecord.id,
    transcriptId: result
  });
});

module.exports = router;
