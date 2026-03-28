#!/usr/bin/env node
/**
 * Targeted fix for polished transcripts: finds overly-long paragraphs that likely
 * contain merged speakers, and sends them to LLM for speaker splitting.
 *
 * This is much faster than re-polishing the entire transcript.
 *
 * Usage:
 *   node scripts/fix-long-paragraphs.js                    # all Chinese polished
 *   node scripts/fix-long-paragraphs.js --episode-id=96    # specific episode
 *   node scripts/fix-long-paragraphs.js --dry-run           # just list problems
 *   node scripts/fix-long-paragraphs.js --threshold=2000    # custom threshold (default 2000)
 */
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');

const API_KEY = process.env.LLM_API_KEY;
const API_URL = process.env.LLM_API_URL || 'http://38.246.250.87:3000/v1/chat/completions';
const MODELS = ['deepseek-chat', 'gpt-4o-mini', 'deepseek-v3', 'gpt-4o'];
const MAX_TOKENS = 16384;

const args = process.argv.slice(2);
const specificEpisode = args.find(a => a.startsWith('--episode-id='))?.split('=')[1];
const dryRun = args.includes('--dry-run');
const THRESHOLD = parseInt(args.find(a => a.startsWith('--threshold='))?.split('=')[1] || '2000');

async function callLLM(messages) {
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, max_tokens: MAX_TOKENS, temperature: 0.3 })
        });
        if (!r.ok) { await new Promise(r => setTimeout(r, 3000)); continue; }
        const d = await r.json();
        return d?.choices?.[0]?.message?.content || null;
      } catch (e) { await new Promise(r => setTimeout(r, 5000)); }
    }
  }
  return null;
}

function makeSplitPrompt(podcastName, host, guests) {
  const speakerInfo = [];
  if (host) speakerInfo.push(`主持人: ${host}`);
  if (guests) speakerInfo.push(`嘉宾: ${guests}`);
  const speakerHint = speakerInfo.length > 0 ? `\n已知说话人：${speakerInfo.join('，')}` : '';

  return `你是播客文字稿说话人标注专家。下面是一段播客文字稿，目前整段被标记为同一个说话人，但实际上**可能包含多个说话人的对话**。

播客：${podcastName}${speakerHint}

任务：
1. 仔细阅读这段文字，识别其中的说话人切换
2. 在每次说话人切换处分段，用**[说话人姓名]**格式标记
3. 特别注意：短句回应（"嗯""对""是的""好""哈哈"等）后面如果转换了话题，很可能是另一个人在说
4. 提问句（以"？"结尾）和其后的回答通常是不同的说话人
5. "你觉得""你怎么看""能讲讲"等提问性语句通常是主持人（${host || '主持人'}）说的
6. **严格保留原文所有文字**，不得删减、改写任何内容
7. 如果确实是同一个人在长篇发言，可以保持不变，不要强行拆分

只输出处理后的文稿，不要任何解释。`;
}

async function main() {
  const db = getDb();

  const where = specificEpisode ? `AND t.episode_id=${parseInt(specificEpisode)}` : '';
  const transcripts = db.prepare(`
    SELECT t.id, t.episode_id, t.content, e.title, e.guests, p.name as podcast_name, p.host
    FROM transcripts t
    JOIN episodes e ON e.id = t.episode_id
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE t.source = 'llm_polish' AND p.language = 'zh' ${where}
  `).all();

  console.log(`Scanning ${transcripts.length} polished transcripts for long paragraphs (threshold: ${THRESHOLD} chars)...\n`);

  let totalFixed = 0, totalParasFixed = 0;
  const start = Date.now();

  for (const tr of transcripts) {
    const paragraphs = tr.content.split('\n\n');
    const longParas = [];

    for (let i = 0; i < paragraphs.length; i++) {
      if (paragraphs[i].length > THRESHOLD) {
        longParas.push({ index: i, text: paragraphs[i], len: paragraphs[i].length });
      }
    }

    if (longParas.length === 0) continue;

    const totalLongChars = longParas.reduce((s, p) => s + p.len, 0);
    console.log(`ep${tr.episode_id}: ${longParas.length} long paragraphs (${(totalLongChars/1000).toFixed(0)}k chars) - ${tr.title?.slice(0, 50)}`);

    if (dryRun) {
      for (const p of longParas) {
        const speaker = p.text.match(/\*\*\[([^\]]+)\]\*\*/)?.[1] || '?';
        console.log(`  para ${p.index}: ${p.len} chars, speaker: ${speaker}, preview: "${p.text.slice(0, 80)}..."`);
      }
      continue;
    }

    const sys = makeSplitPrompt(tr.podcast_name, tr.host, tr.guests);
    let changed = false;

    for (const lp of longParas) {
      // Send to LLM for splitting
      process.stdout.write(`  para ${lp.index} (${lp.len} chars)... `);

      // For very long paragraphs, chunk them
      const text = lp.text;
      let result;

      if (text.length > 6000) {
        // Split into sub-chunks and process
        const subResults = [];
        let pos = 0;
        while (pos < text.length) {
          const end = Math.min(pos + 4000, text.length);
          // Try to break at sentence boundary
          let breakPos = end;
          if (end < text.length) {
            const lastPeriod = text.lastIndexOf('。', end);
            const lastQuestion = text.lastIndexOf('？', end);
            const lastExcl = text.lastIndexOf('！', end);
            breakPos = Math.max(lastPeriod, lastQuestion, lastExcl);
            if (breakPos <= pos) breakPos = end;
            else breakPos++; // Include the punctuation
          }
          const chunk = text.slice(pos, breakPos);
          const r = await callLLM([{ role: 'system', content: sys }, { role: 'user', content: chunk }]);
          if (r) subResults.push(r);
          else subResults.push(chunk); // Keep original if LLM fails
          pos = breakPos;
        }
        result = subResults.join('\n\n');
      } else {
        result = await callLLM([{ role: 'system', content: sys }, { role: 'user', content: text }]);
      }

      if (!result) {
        console.log('FAIL');
        continue;
      }

      // Check if LLM actually split it
      const newTags = (result.match(/\*\*\[[^\]]+\]\*\*/g) || []).length;
      const oldTags = (text.match(/\*\*\[[^\]]+\]\*\*/g) || []).length;

      if (newTags > oldTags) {
        paragraphs[lp.index] = result;
        changed = true;
        console.log(`SPLIT (${oldTags}→${newTags} tags)`);
        totalParasFixed++;
      } else {
        // Check if output is much shorter (LLM summarized instead of preserving)
        if (result.length < text.length * 0.7) {
          console.log(`SKIP (output too short: ${result.length} vs ${text.length})`);
        } else {
          // LLM didn't split but may have made minor fixes
          paragraphs[lp.index] = result;
          changed = true;
          console.log(`OK (no split needed, ${newTags} tags)`);
        }
      }
    }

    if (changed) {
      const newContent = paragraphs.join('\n\n');
      db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(newContent, tr.id);
      totalFixed++;
      console.log(`  SAVED ep${tr.episode_id} (${(newContent.length/1000).toFixed(0)}k chars)`);
    }
  }

  console.log(`\n=== Done in ${((Date.now()-start)/60000).toFixed(1)}m: ${totalFixed} episodes fixed, ${totalParasFixed} paragraphs split ===`);
  closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
