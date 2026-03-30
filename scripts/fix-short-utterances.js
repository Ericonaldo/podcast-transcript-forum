#!/usr/bin/env node
/**
 * Fix misattributed short utterances inside long speaker paragraphs.
 * Detects patterns like:
 *   "...你猜猜？3个小时？高估了。3分钟？还是高估了。3秒钟？大概是8秒..."
 * where short Q&A exchanges are merged into one speaker's paragraph.
 *
 * Uses LLM to split these paragraphs at conversational turn boundaries.
 *
 * Usage: node scripts/fix-short-utterances.js [--episode-id=96] [--dry-run]
 */
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');

const API_KEY = process.env.LLM_API_KEY;
const API_URL = process.env.LLM_API_URL;
const MODELS = ['deepseek-chat', 'gpt-4o-mini'];

const args = process.argv.slice(2);
const episodeId = args.find(a => a.startsWith('--episode-id='))?.split('=')[1];
const dryRun = args.includes('--dry-run');

async function callLLM(messages) {
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        const r = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, max_tokens: 16384, temperature: 0.2 }),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (!r.ok) continue;
        const d = await r.json();
        return d?.choices?.[0]?.message?.content || null;
      } catch (e) { await new Promise(r => setTimeout(r, 3000)); }
    }
  }
  return null;
}

// Detect paragraphs with embedded Q&A patterns
function hasEmbeddedQA(text) {
  // Pattern: short question (ending with ？) followed by a response, inside same paragraph
  // Look for 2+ question marks with short text between them
  const questions = text.match(/[^。！？]{1,20}？/g) || [];
  if (questions.length < 2) return false;

  // Check if questions are surrounded by non-question text (indicating conversation)
  const qPositions = [];
  let pos = 0;
  for (const q of text.match(/[^。！？]{1,20}？/g) || []) {
    const idx = text.indexOf(q, pos);
    if (idx >= 0) { qPositions.push(idx); pos = idx + q.length; }
  }

  // If questions are spread out (not all at the end), likely embedded Q&A
  if (qPositions.length >= 2) {
    const spread = qPositions[qPositions.length - 1] - qPositions[0];
    if (spread > 100 && spread < text.length * 0.8) return true;
  }

  return false;
}

async function main() {
  const db = getDb();
  const where = episodeId ? `AND t.episode_id=${parseInt(episodeId)}` : '';

  const transcripts = db.prepare(`
    SELECT t.id, t.episode_id, t.content, e.title, e.guests, p.name as podcast_name, p.host
    FROM transcripts t
    JOIN episodes e ON e.id = t.episode_id
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE t.source = 'llm_polish' AND p.language = 'zh' ${where}
  `).all();

  console.log(`Scanning ${transcripts.length} transcripts for embedded Q&A...`);
  let totalFixed = 0;

  for (const tr of transcripts) {
    const paras = tr.content.split('\n\n');
    const candidates = [];

    for (let i = 0; i < paras.length; i++) {
      const p = paras[i];
      // Only check long paragraphs (>800 chars) that might have embedded conversation
      if (p.length > 800 && hasEmbeddedQA(p)) {
        candidates.push(i);
      }
    }

    if (candidates.length === 0) continue;

    console.log(`\nep${tr.episode_id}: ${candidates.length} paragraphs with possible embedded Q&A`);
    if (dryRun) {
      for (const idx of candidates) {
        const speaker = paras[idx].match(/\*\*\[([^\]]+)\]\*\*/)?.[1] || '?';
        console.log(`  P${idx} [${speaker}] ${paras[idx].length} chars: "${paras[idx].slice(0, 100)}..."`);
      }
      continue;
    }

    const sys = `你是播客文字稿编辑专家。下面是一段播客文字稿，标记为同一个说话人，但实际上可能包含多个说话人的对话交替。

播客：${tr.podcast_name}
主持人：${tr.host || '未知'}

任务：仔细检查这段文字，如果发现说话人切换（如提问→回答、短回应→新话题），在切换处分段并标注正确的说话人**[姓名]**。

规则：
1. 短问句（如"3分钟？""真的吗？""为什么？"）通常是另一个说话人（主持人）的插话
2. "嗯""对""是的""哈哈"等回应后如果话题转换，可能是说话人切换
3. **严格保留原文所有文字**，不得删改
4. 如果确实是同一人在说，保持不变

只输出处理后的文字。`;

    let changed = false;
    for (const idx of candidates) {
      process.stdout.write(`  P${idx} (${paras[idx].length} chars)... `);
      const result = await callLLM([{ role: 'system', content: sys }, { role: 'user', content: paras[idx] }]);
      if (!result) { console.log('FAIL'); continue; }

      const newTags = (result.match(/\*\*\[[^\]]+\]\*\*/g) || []).length;
      const oldTags = (paras[idx].match(/\*\*\[[^\]]+\]\*\*/g) || []).length;

      if (newTags > oldTags && result.length > paras[idx].length * 0.7) {
        paras[idx] = result;
        changed = true;
        console.log(`SPLIT (${oldTags}→${newTags} tags)`);
        totalFixed++;
      } else {
        console.log(`OK (no split needed)`);
      }
    }

    if (changed) {
      const newContent = paras.join('\n\n');
      db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(newContent, tr.id);
      console.log(`  SAVED ep${tr.episode_id}`);
    }
  }

  console.log(`\nDone: ${totalFixed} paragraphs fixed`);
  closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
