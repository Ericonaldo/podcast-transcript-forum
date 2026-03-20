const express = require('express');
const router = express.Router({ mergeParams: true }); // gives us :episodeId
const crypto = require('crypto');
const { getDb } = require('../db');

/** Generate a short sha from content + timestamp, like a git commit hash */
function makesha(content, timestamp) {
  return crypto
    .createHash('sha1')
    .update(content + timestamp)
    .digest('hex')
    .slice(0, 40);
}

/**
 * GET /api/episodes/:episodeId/revisions
 * List all revisions for an episode — like `git log`
 */
router.get('/', (req, res) => {
  const db = getDb();
  const episode = db.prepare('SELECT id FROM episodes WHERE id = ?').get(req.params.episodeId);
  if (!episode) return res.status(404).json({ error: 'Episode not found' });

  const revisions = db.prepare(`
    SELECT id, sha, message, author, source, parent_id, created_at,
           length(content) as content_length
    FROM transcript_revisions
    WHERE episode_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(req.params.episodeId);

  res.json(revisions);
});

/**
 * GET /api/episodes/:episodeId/revisions/:sha
 * Get a specific revision by sha (or id) — like `git show <sha>`
 */
router.get('/:sha', (req, res) => {
  const db = getDb();
  const rev = db.prepare(`
    SELECT * FROM transcript_revisions
    WHERE episode_id = ? AND (sha = ? OR id = ?)
    LIMIT 1
  `).get(req.params.episodeId, req.params.sha, req.params.sha);

  if (!rev) return res.status(404).json({ error: 'Revision not found' });
  res.json(rev);
});

/**
 * POST /api/episodes/:episodeId/revisions
 * Submit a new revision — like `git commit`
 * Body: { content, message?, author? }
 * Creates a snapshot of current transcript, then updates it.
 */
router.post('/', (req, res) => {
  const db = getDb();
  const episode = db.prepare('SELECT id FROM episodes WHERE id = ?').get(req.params.episodeId);
  if (!episode) return res.status(404).json({ error: 'Episode not found' });

  const { content, message, author, source } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });

  const now = new Date().toISOString();
  const sha = makesha(content, now);

  // Find parent: the most recent revision for this episode
  const parent = db.prepare(`
    SELECT id FROM transcript_revisions
    WHERE episode_id = ?
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(req.params.episodeId);

  const result = db.transaction(() => {
    // Insert revision
    const revResult = db.prepare(`
      INSERT INTO transcript_revisions (episode_id, content, message, author, source, parent_id, sha)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.episodeId,
      content,
      message || 'Update transcript',
      author || 'Anonymous',
      source || 'community_edit',
      parent ? parent.id : null,
      sha
    );

    // Update the live transcript
    const existingTranscript = db.prepare('SELECT id FROM transcripts WHERE episode_id = ?').get(req.params.episodeId);
    if (existingTranscript) {
      db.prepare(`
        UPDATE transcripts SET content=?, source=?, updated_at=CURRENT_TIMESTAMP WHERE episode_id=?
      `).run(content, source || 'community_edit', req.params.episodeId);
    } else {
      db.prepare(`
        INSERT INTO transcripts (episode_id, content, format, language, source)
        VALUES (?, ?, 'plain', 'zh', ?)
      `).run(req.params.episodeId, content, source || 'community_edit');
    }

    return db.prepare('SELECT * FROM transcript_revisions WHERE id = ?').get(revResult.lastInsertRowid);
  })();

  res.status(201).json(result);
});

/**
 * POST /api/episodes/:episodeId/revisions/:sha/restore
 * Restore an episode to a previous revision — like `git revert` / `git checkout`
 * Creates a NEW revision pointing to the restored content (non-destructive)
 */
router.post('/:sha/restore', (req, res) => {
  const db = getDb();
  const rev = db.prepare(`
    SELECT * FROM transcript_revisions
    WHERE episode_id = ? AND (sha = ? OR CAST(id AS TEXT) = ?)
    LIMIT 1
  `).get(req.params.episodeId, req.params.sha, req.params.sha);

  if (!rev) return res.status(404).json({ error: 'Revision not found' });

  const now = new Date().toISOString();
  const sha = makesha(rev.content, now);

  const parent = db.prepare(`
    SELECT id FROM transcript_revisions
    WHERE episode_id = ?
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(req.params.episodeId);

  const result = db.transaction(() => {
    const revResult = db.prepare(`
      INSERT INTO transcript_revisions (episode_id, content, message, author, source, parent_id, sha)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.episodeId,
      rev.content,
      `回滚到 ${rev.sha.slice(0, 7)}: ${rev.message}`,
      req.body.author || 'Anonymous',
      'revert',
      parent ? parent.id : null,
      sha
    );

    // Update live transcript
    db.prepare(`
      UPDATE transcripts SET content=?, source='revert', updated_at=CURRENT_TIMESTAMP WHERE episode_id=?
    `).run(rev.content, req.params.episodeId);

    return db.prepare('SELECT * FROM transcript_revisions WHERE id = ?').get(revResult.lastInsertRowid);
  })();

  res.status(201).json(result);
});

module.exports = router;
