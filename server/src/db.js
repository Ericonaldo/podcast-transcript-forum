const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'podcast.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrateFtsTrigram(db);
    initSchema(db);
  }
  return db;
}

// Migrate: drop old FTS triggers and content-sync FTS tables, use standalone FTS
function migrateFtsTrigram(db) {
  try {
    // Always drop triggers (they cause DB corruption with concurrent writes)
    db.exec(`
      DROP TRIGGER IF EXISTS transcripts_ai;
      DROP TRIGGER IF EXISTS transcripts_ad;
      DROP TRIGGER IF EXISTS transcripts_au;
      DROP TRIGGER IF EXISTS episodes_ai;
      DROP TRIGGER IF EXISTS episodes_ad;
      DROP TRIGGER IF EXISTS episodes_au;
      DROP TRIGGER IF EXISTS podcasts_ai;
      DROP TRIGGER IF EXISTS podcasts_ad;
      DROP TRIGGER IF EXISTS podcasts_au;
    `);
    // Check if FTS tables use content-sync (old style) and need migration
    const ftsInfo = db.prepare("SELECT sql FROM sqlite_master WHERE name='transcripts_fts'").get();
    if (ftsInfo && (ftsInfo.sql.includes("content='") || !ftsInfo.sql.includes('trigram'))) {
      db.exec(`
        DROP TABLE IF EXISTS transcripts_fts;
        DROP TABLE IF EXISTS episodes_fts;
        DROP TABLE IF EXISTS podcasts_fts;
      `);
    }
  } catch (e) {
    // If migration fails, just continue - initSchema will handle it
  }
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS podcasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT,
      description TEXT,
      category TEXT,
      image_url TEXT,
      website_url TEXT,
      rss_url TEXT,
      language TEXT DEFAULT 'zh',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      podcast_id INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      published_date TEXT,
      duration INTEGER,
      audio_url TEXT,
      episode_url TEXT,
      episode_number INTEGER,
      season_number INTEGER,
      image_url TEXT,
      guests TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      format TEXT DEFAULT 'plain',
      language TEXT DEFAULT 'zh',
      source TEXT DEFAULT 'manual',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- FTS tables without content-sync (standalone) to avoid corruption from triggers
    CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
      content,
      tokenize="trigram"
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
      title,
      description,
      guests,
      tokenize="trigram"
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS podcasts_fts USING fts5(
      name,
      host,
      description,
      tokenize="trigram"
    );

    CREATE INDEX IF NOT EXISTS idx_episodes_podcast_id ON episodes(podcast_id);
    CREATE INDEX IF NOT EXISTS idx_episodes_published_date ON episodes(published_date);
    CREATE INDEX IF NOT EXISTS idx_transcripts_episode_id ON transcripts(episode_id);

    -- Git-like revision history for transcripts
    CREATE TABLE IF NOT EXISTS transcript_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      message TEXT DEFAULT 'Update transcript',
      author TEXT DEFAULT 'Anonymous',
      source TEXT DEFAULT 'community_edit',
      parent_id INTEGER REFERENCES transcript_revisions(id),
      sha TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_revisions_episode_id ON transcript_revisions(episode_id);
    CREATE INDEX IF NOT EXISTS idx_revisions_parent_id ON transcript_revisions(parent_id);
  `);

  // Populate FTS tables if they're empty (after migration or fresh install)
  try {
    const ftsTranscriptCount = db.prepare('SELECT COUNT(*) as c FROM transcripts_fts').get().c;
    if (ftsTranscriptCount === 0) {
      rebuildFts(db);
    }
  } catch (e) {
    // FTS tables may be corrupted, try to rebuild
    try { rebuildFts(db); } catch (e2) { console.error('FTS rebuild failed:', e2.message); }
  }
}

function rebuildFts(dbInstance) {
  const db = dbInstance || getDb();
  // Drop and recreate FTS tables to handle corruption
  db.exec(`
    DROP TABLE IF EXISTS transcripts_fts;
    DROP TABLE IF EXISTS episodes_fts;
    DROP TABLE IF EXISTS podcasts_fts;
    CREATE VIRTUAL TABLE transcripts_fts USING fts5(content, tokenize="trigram");
    CREATE VIRTUAL TABLE episodes_fts USING fts5(title, description, guests, tokenize="trigram");
    CREATE VIRTUAL TABLE podcasts_fts USING fts5(name, host, description, tokenize="trigram");
  `);
  const trCount = db.prepare('SELECT COUNT(*) as c FROM transcripts').get().c;
  if (trCount > 0) {
    db.exec(`INSERT INTO transcripts_fts(rowid, content) SELECT id, content FROM transcripts`);
  }
  const epCount = db.prepare('SELECT COUNT(*) as c FROM episodes').get().c;
  if (epCount > 0) {
    db.exec(`INSERT INTO episodes_fts(rowid, title, description, guests) SELECT id, title, COALESCE(description,''), COALESCE(guests,'') FROM episodes`);
  }
  const podCount = db.prepare('SELECT COUNT(*) as c FROM podcasts').get().c;
  if (podCount > 0) {
    db.exec(`INSERT INTO podcasts_fts(rowid, name, host, description) SELECT id, name, COALESCE(host,''), COALESCE(description,'') FROM podcasts`);
  }
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb, rebuildFts };
