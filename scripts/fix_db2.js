const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.argv[2] || path.join(__dirname, '../data/podcast.db');
const newDbPath = dbPath + '.new';
console.log('Fixing DB:', dbPath);

// Open old DB in readonly mode
const oldDb = new Database(dbPath, { readonly: true });

// Create new DB
if (fs.existsSync(newDbPath)) fs.unlinkSync(newDbPath);
const newDb = new Database(newDbPath);
newDb.pragma('journal_mode = WAL');
newDb.pragma('foreign_keys = ON');

// Create schema
newDb.exec(`
  CREATE TABLE podcasts (
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
  CREATE TABLE episodes (
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
  CREATE TABLE transcripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    format TEXT DEFAULT 'plain',
    language TEXT DEFAULT 'zh',
    source TEXT DEFAULT 'manual',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE transcript_revisions (
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
  CREATE INDEX idx_episodes_podcast_id ON episodes(podcast_id);
  CREATE INDEX idx_episodes_published_date ON episodes(published_date);
  CREATE INDEX idx_transcripts_episode_id ON transcripts(episode_id);
  CREATE INDEX idx_revisions_episode_id ON transcript_revisions(episode_id);
  CREATE INDEX idx_revisions_parent_id ON transcript_revisions(parent_id);
`);

// Copy data
console.log('Copying podcasts...');
const podcasts = oldDb.prepare('SELECT * FROM podcasts').all();
const insertPodcast = newDb.prepare(`INSERT INTO podcasts VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
for (const p of podcasts) {
  insertPodcast.run(p.id, p.name, p.host, p.description, p.category, p.image_url, p.website_url, p.rss_url, p.language, p.created_at, p.updated_at);
}
console.log(`  ${podcasts.length} podcasts`);

console.log('Copying episodes...');
const episodes = oldDb.prepare('SELECT * FROM episodes').all();
const insertEpisode = newDb.prepare(`INSERT INTO episodes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
for (const e of episodes) {
  insertEpisode.run(e.id, e.podcast_id, e.title, e.description, e.published_date, e.duration, e.audio_url, e.episode_url, e.episode_number, e.season_number, e.image_url, e.guests, e.created_at, e.updated_at);
}
console.log(`  ${episodes.length} episodes`);

console.log('Copying transcripts...');
let transcriptCount = 0;
try {
  // Try bulk copy first
  const transcripts = oldDb.prepare('SELECT * FROM transcripts').all();
  const insertTranscript = newDb.prepare(`INSERT INTO transcripts VALUES (?,?,?,?,?,?,?,?)`);
  for (const t of transcripts) {
    insertTranscript.run(t.id, t.episode_id, t.content, t.format, t.language, t.source, t.created_at, t.updated_at);
    transcriptCount++;
  }
} catch(e) {
  console.log('  Bulk copy failed, trying row-by-row...');
  // Get transcript IDs from episodes that exist
  const epIds = newDb.prepare('SELECT id FROM episodes').all().map(r => r.id);
  const insertTranscript = newDb.prepare(`INSERT OR IGNORE INTO transcripts VALUES (?,?,?,?,?,?,?,?)`);
  for (const epId of epIds) {
    try {
      const ts = oldDb.prepare('SELECT * FROM transcripts WHERE episode_id = ?').all(epId);
      for (const t of ts) {
        try {
          insertTranscript.run(t.id, t.episode_id, t.content, t.format, t.language, t.source, t.created_at, t.updated_at);
          transcriptCount++;
        } catch(e2) { console.log(`  Skip transcript ${t.id}: ${e2.message}`); }
      }
    } catch(e2) { /* skip corrupted rows */ }
  }
}
console.log(`  ${transcriptCount} transcripts`);

console.log('Copying revisions...');
try {
  const revisions = oldDb.prepare('SELECT * FROM transcript_revisions').all();
  const insertRev = newDb.prepare(`INSERT INTO transcript_revisions VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const r of revisions) {
    insertRev.run(r.id, r.episode_id, r.content, r.message, r.author, r.source, r.parent_id, r.sha, r.created_at);
  }
  console.log(`  ${revisions.length} revisions`);
} catch(e) { console.log('  No revisions table or error:', e.message); }

// Create standalone FTS tables (no triggers - they cause corruption)
console.log('Creating FTS...');
newDb.exec(`
  CREATE VIRTUAL TABLE transcripts_fts USING fts5(content, tokenize="trigram");
  CREATE VIRTUAL TABLE episodes_fts USING fts5(title, description, guests, tokenize="trigram");
  CREATE VIRTUAL TABLE podcasts_fts USING fts5(name, host, description, tokenize="trigram");
`);
newDb.exec(`INSERT INTO episodes_fts(rowid, title, description, guests) SELECT id, title, COALESCE(description,''), COALESCE(guests,'') FROM episodes`);
newDb.exec(`INSERT INTO podcasts_fts(rowid, name, host, description) SELECT id, name, COALESCE(host,''), COALESCE(description,'') FROM podcasts`);
newDb.exec(`INSERT INTO transcripts_fts(rowid, content) SELECT id, content FROM transcripts`);
`);

// Check integrity
const result = newDb.pragma('integrity_check');
console.log('Integrity:', result[0].integrity_check);

oldDb.close();
newDb.close();

// Swap files
const backupPath = dbPath + '.corrupt';
fs.renameSync(dbPath, backupPath);
fs.renameSync(newDbPath, dbPath);
// Also remove WAL/SHM files for old DB
try { fs.unlinkSync(dbPath + '-wal'); } catch(e) {}
try { fs.unlinkSync(dbPath + '-shm'); } catch(e) {}

console.log('DB fixed! Old DB saved as', backupPath);
