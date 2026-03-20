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
    initSchema(db);
  }
  return db;
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

    CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
      content,
      content='transcripts',
      content_rowid='id',
      tokenize='unicode61'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
      title,
      description,
      guests,
      content='episodes',
      content_rowid='id',
      tokenize='unicode61'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS podcasts_fts USING fts5(
      name,
      host,
      description,
      content='podcasts',
      content_rowid='id',
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS transcripts_ai AFTER INSERT ON transcripts BEGIN
      INSERT INTO transcripts_fts(rowid, content) VALUES (new.id, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS transcripts_ad AFTER DELETE ON transcripts BEGIN
      INSERT INTO transcripts_fts(transcripts_fts, rowid, content) VALUES('delete', old.id, old.content);
    END;

    CREATE TRIGGER IF NOT EXISTS transcripts_au AFTER UPDATE ON transcripts BEGIN
      INSERT INTO transcripts_fts(transcripts_fts, rowid, content) VALUES('delete', old.id, old.content);
      INSERT INTO transcripts_fts(rowid, content) VALUES (new.id, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS episodes_ai AFTER INSERT ON episodes BEGIN
      INSERT INTO episodes_fts(rowid, title, description, guests) VALUES (new.id, new.title, COALESCE(new.description,''), COALESCE(new.guests,''));
    END;

    CREATE TRIGGER IF NOT EXISTS episodes_ad AFTER DELETE ON episodes BEGIN
      INSERT INTO episodes_fts(episodes_fts, rowid, title, description, guests) VALUES('delete', old.id, old.title, COALESCE(old.description,''), COALESCE(old.guests,''));
    END;

    CREATE TRIGGER IF NOT EXISTS episodes_au AFTER UPDATE ON episodes BEGIN
      INSERT INTO episodes_fts(episodes_fts, rowid, title, description, guests) VALUES('delete', old.id, old.title, COALESCE(old.description,''), COALESCE(old.guests,''));
      INSERT INTO episodes_fts(rowid, title, description, guests) VALUES (new.id, new.title, COALESCE(new.description,''), COALESCE(new.guests,''));
    END;

    CREATE TRIGGER IF NOT EXISTS podcasts_ai AFTER INSERT ON podcasts BEGIN
      INSERT INTO podcasts_fts(rowid, name, host, description) VALUES (new.id, new.name, COALESCE(new.host,''), COALESCE(new.description,''));
    END;

    CREATE TRIGGER IF NOT EXISTS podcasts_ad AFTER DELETE ON podcasts BEGIN
      INSERT INTO podcasts_fts(podcasts_fts, rowid, name, host, description) VALUES('delete', old.id, old.name, COALESCE(old.host,''), COALESCE(old.description,''));
    END;

    CREATE TRIGGER IF NOT EXISTS podcasts_au AFTER UPDATE ON podcasts BEGIN
      INSERT INTO podcasts_fts(podcasts_fts, rowid, name, host, description) VALUES('delete', old.id, old.name, COALESCE(old.host,''), COALESCE(old.description,''));
      INSERT INTO podcasts_fts(rowid, name, host, description) VALUES (new.id, new.name, COALESCE(new.host,''), COALESCE(new.description,''));
    END;

    CREATE INDEX IF NOT EXISTS idx_episodes_podcast_id ON episodes(podcast_id);
    CREATE INDEX IF NOT EXISTS idx_episodes_published_date ON episodes(published_date);
    CREATE INDEX IF NOT EXISTS idx_transcripts_episode_id ON transcripts(episode_id);
  `);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
