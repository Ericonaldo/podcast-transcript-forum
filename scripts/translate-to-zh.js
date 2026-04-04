#!/usr/bin/env node
/**
 * Translate English polished transcripts to Chinese.
 * For episodes that already have an English polished/raw transcript but no Chinese version.
 * Always translates from the English transcript source instead of importing
 * YouTube captions, so speaker tags stay aligned with the ASR-based pipeline.
 */
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');

const API_KEY = 'sk-3ODOY96LmDCFgcBY1d1b586c01E448BcAbB5115bD8FbD2Fc';
const API_URL = 'http://38.246.250.87:3000/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
const CHUNK_SIZE = 3000;
const MAX_LEN = 150000;

const TRANSLATE_PROMPT = `You are a professional podcast transcript translator. Translate the following English podcast transcript into Chinese (Simplified).

Rules:
1. Translate naturally and fluently, not word-by-word
2. Keep **[Speaker Name]** tags as-is (do NOT translate speaker names)
3. Keep [MM:SS] timestamps as-is
4. Maintain the same paragraph structure
5. Use appropriate Chinese punctuation
6. For technical terms, keep the English in parentheses after the Chinese translation

Output only the translated transcript.`;

async function callLLM(text) {
  for (let i = 0; i < 3; i++) {
    try {
      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: TRANSLATE_PROMPT },
            { role: 'user', content: text }
          ],
          max_tokens: 4096
        })
      });
      if (resp.status === 429) { await new Promise(r => setTimeout(r, 5000 * (i + 1))); continue; }
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const d = await resp.json();
      return d?.choices?.[0]?.message?.content || text;
    } catch (e) {
      if (i === 2) throw e;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function main() {
  const db = getDb();

  // Find English episodes that don't have a Chinese transcript
  const episodes = db.prepare(`
    SELECT DISTINCT e.id as episode_id, e.title, e.episode_url, p.name as podcast_name
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    JOIN transcripts t ON t.episode_id = e.id
    WHERE p.language = 'en'
    AND e.id NOT IN (SELECT episode_id FROM transcripts WHERE language LIKE 'zh%')
    ORDER BY LENGTH((SELECT content FROM transcripts WHERE episode_id=e.id LIMIT 1)) ASC
  `).all();

  console.log(`\n🌐 Translate to Chinese: ${episodes.length} episodes\n`);
  const start = Date.now();
  let done = 0, llmDone = 0, failed = 0;

  for (let idx = 0; idx < episodes.length; idx++) {
    const ep = episodes[idx];
    const elapsed = ((Date.now() - start) / 60000).toFixed(1);
    process.stdout.write(`[${idx + 1}/${episodes.length}] (${elapsed}m) ${ep.podcast_name.slice(0, 12)} | ${ep.title.slice(0, 40)}... `);

    const enTr = db.prepare("SELECT content FROM transcripts WHERE episode_id=? AND source IN ('llm_polish','asr','rss_transcript') ORDER BY CASE source WHEN 'llm_polish' THEN 0 WHEN 'asr' THEN 1 ELSE 2 END LIMIT 1").get(ep.episode_id);
    if (!enTr || enTr.content.length > MAX_LEN) {
      console.log('SKIP (no transcript or too large)');
      failed++;
      continue;
    }

    // Chunk and translate
    const lines = enTr.content.split('\n');
    const chunks = [];
    let cur = '';
    for (const l of lines) {
      if (cur.length + l.length > CHUNK_SIZE && cur.length > 0) { chunks.push(cur); cur = ''; }
      cur += (cur ? '\n' : '') + l;
    }
    if (cur) chunks.push(cur);

    try {
      const results = [];
      for (const chunk of chunks) {
        const translated = await callLLM(chunk);
        results.push(translated);
      }
      const zhContent = results.join('\n\n');
      db.prepare('INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, ?, ?, ?)').run(
        ep.episode_id, zhContent, 'plain', 'zh', 'llm_translate'
      );
      console.log(`OK (${chunks.length}ch, ${(zhContent.length / 1000).toFixed(0)}k)`);
      llmDone++;
      done++;
    } catch (e) {
      console.log(`FAIL: ${e.message.slice(0, 60)}`);
      failed++;
    }
  }

  console.log(`\n✅ ${((Date.now() - start) / 60000).toFixed(1)}m: ${done} done (${llmDone} LLM translated), ${failed} failed`);
  closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
