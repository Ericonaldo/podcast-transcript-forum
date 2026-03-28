#!/usr/bin/env node
/**
 * Quality re-polish script for Chinese podcast transcripts.
 * Fixes: incomplete polish, merged speakers, wrong attribution.
 *
 * Key improvements over fast-polish.js:
 * - max_tokens: 16384 (was 4096) to avoid truncation
 * - CHUNK_SIZE: 1500 (was 3000) for better speaker separation
 * - Output length validation: retries if output is too short
 * - Better prompt emphasizing speaker turn detection
 * - Handles both ASR and VTT source material
 *
 * Usage:
 *   node scripts/repolish-quality.js                    # all broken Chinese episodes
 *   node scripts/repolish-quality.js --episode-id=107   # specific episode
 *   node scripts/repolish-quality.js --dry-run           # just list what would be processed
 */
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');

const API_KEY = process.env.LLM_API_KEY;
const API_URL = process.env.LLM_API_URL || 'http://38.246.250.87:3000/v1/chat/completions';
const CHUNK_SIZE = 1500;  // Smaller chunks for better speaker separation
const MAX_TOKENS = 16384; // Much higher to avoid truncation
const MIN_OUTPUT_RATIO = 0.5; // Output must be at least 50% of input length
const MAX_RETRIES = 3;

const MODELS = ['deepseek-chat', 'gpt-4o-mini', 'deepseek-v3', 'gpt-4o'];

const args = process.argv.slice(2);
const specificEpisode = args.find(a => a.startsWith('--episode-id='))?.split('=')[1];
const dryRun = args.includes('--dry-run');
const forceAll = args.includes('--force-all');
// Threshold: episodes with avg paragraph size above this are considered broken
const AVG_PARA_THRESHOLD = parseInt(args.find(a => a.startsWith('--threshold='))?.split('=')[1] || '1200');

function vttToPlain(content) {
  const cues = [];
  for (const block of content.split(/\n\s*\n/)) {
    const lines = block.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length || /^(WEBVTT|NOTE|STYLE|Kind:|Language:)/.test(lines[0])) continue;
    const ti = lines.findIndex(l => l.includes('-->'));
    if (ti === -1) continue;
    const m = lines[ti].match(/([\d:.]+)/);
    const secs = m ? m[1].split(':').reduce((a,v,i,arr) => a+parseFloat(v)*Math.pow(60,arr.length-1-i),0) : 0;
    const text = lines.slice(ti+1).map(l => l.replace(/<\d{1,2}:\d{2}:\d{2}[.,]\d{3}>/g,'').replace(/<\/?[a-z][^>]*>/gi,'').trim()).filter(Boolean).join(' ');
    if (text) cues.push({secs, text});
  }
  if (!cues.length) return content;

  // Group into 30-second windows (smaller than before for better granularity)
  const groups = [];
  let ws = cues[0].secs, wt = [], wts = formatTime(cues[0].secs);
  for (const c of cues) {
    if (c.secs - ws >= 30 && wt.length) {
      groups.push('['+wts+'] '+wt.join(' '));
      ws = c.secs; wt = []; wts = formatTime(c.secs);
    }
    wt.push(c.text);
  }
  if (wt.length) groups.push('['+wts+'] '+wt.join(' '));
  return groups.join('\n');
}

function formatTime(secs) {
  return Math.floor(secs/60)+':'+String(Math.floor(secs%60)).padStart(2,'0');
}

function makePrompt(podcastName, host, guests, episodeTitle, episodeDesc, hasASRLabels) {
  const speakerInfo = [];
  if (host) speakerInfo.push(`Host/主持人: ${host}`);
  if (guests) speakerInfo.push(`Guest(s)/嘉宾: ${guests}`);
  const speakerHint = speakerInfo.length > 0 ? `\n已知说话人：${speakerInfo.join('，')}` : '';
  const descHint = episodeDesc ? `\n节目简介（参考嘉宾姓名拼写）：${episodeDesc.slice(0, 500)}` : '';

  const speakerLabelRule = hasASRLabels
    ? `3. 原文中有[SPEAKER_00]、[SPEAKER_01]等说话人标签。将它们替换为真实姓名**[真名]**格式。**严格遵循原有的说话人标签分配**——如果原文标记为SPEAKER_00，就用对应的真名，不要自作主张更改说话人归属。
4. 注意：ASR说话人标签可能在段落内交替——一个段落可能包含两个说话人的内容。当你发现段内有不同SPEAKER标签时，必须在该处分段。`
    : `3. 用**[说话人真实姓名]**格式标记每位说话人（参考已知说话人信息，注意同音字！绝不使用"嘉宾""真名""说话人"等泛称）
4. **关键：必须在每次说话人切换处分段**。一个人提问，另一个人回答，必须是两个独立段落。检测段内问答交替。`;

  return `你是专业播客文字稿编辑器。将语音转录优化为高质量可读文字稿。

播客：${podcastName}
本期：${episodeTitle}${speakerHint}${descHint}

严格要求：
1. **保留原文所有内容**——不得删减、省略、总结任何文字。输出长度应与输入大致相同。
2. 添加标点符号，修正明显语音识别错误（同音字等）
${speakerLabelRule}
5. 同一说话人的连续内容合并为一个大段落（每段至少50字）
6. 每段开头保留一个时间戳[MM:SS]
7. 不改变原意和语序
8. 每个说话人每次发言都必须以**[说话人]**开头单独成段

只输出处理后的完整文稿，不要任何解释或注释。`;
}

async function callLLM(messages, model) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout
  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, max_tokens: MAX_TOKENS, temperature: 0.3 }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (resp.status === 429) {
      await new Promise(r => setTimeout(r, 10000));
      throw new Error('Rate limited');
    }
    if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text().catch(() => '')}`);
    const d = await resp.json();
    return d?.choices?.[0]?.message?.content || null;
  } catch(e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('API timeout (120s)');
    throw e;
  }
}

async function callLLMWithRetry(messages) {
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await callLLM(messages, model);
        if (result) return result;
      } catch (e) {
        if (e.message.includes('Rate limited')) {
          await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
        } else {
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }
  }
  return null;
}

async function polishEpisode(db, episodeId) {
  // Get episode info
  const ep = db.prepare(`
    SELECT e.id, e.title, e.description, e.guests, p.name as podcast_name, p.host
    FROM episodes e JOIN podcasts p ON p.id=e.podcast_id
    WHERE e.id=?
  `).get(episodeId);
  if (!ep) { console.log(`  Episode ${episodeId} not found`); return null; }

  // Get best source transcript (prefer ASR, then VTT, then manual)
  const source = db.prepare(`
    SELECT content, format, source FROM transcripts
    WHERE episode_id=? AND source IN ('asr', 'manual')
    ORDER BY
      CASE source WHEN 'asr' THEN 0 ELSE 1 END,
      created_at DESC
    LIMIT 1
  `).get(episodeId);

  let rawContent;
  let sourceType;
  if (source) {
    rawContent = source.content;
    sourceType = source.source;
  } else {
    // Fall back to VTT
    const vtt = db.prepare(`
      SELECT content, format FROM transcripts
      WHERE episode_id=? AND format='vtt' AND language='zh'
      ORDER BY created_at DESC LIMIT 1
    `).get(episodeId);
    if (!vtt) {
      // Try any VTT
      const anyVtt = db.prepare(`
        SELECT content, format FROM transcripts
        WHERE episode_id=? AND format='vtt'
        ORDER BY LENGTH(content) ASC LIMIT 1
      `).get(episodeId);
      if (!anyVtt) { console.log(`  No source transcript for episode ${episodeId}`); return null; }
      rawContent = vttToPlain(anyVtt.content);
      sourceType = 'vtt';
    } else {
      rawContent = vttToPlain(vtt.content);
      sourceType = 'vtt';
    }
  }

  console.log(`  Title: ${ep.title.slice(0, 70)}`);
  console.log(`  Source: ${sourceType}, ${(rawContent.length/1000).toFixed(0)}k chars | Host: ${ep.host || '?'} | Guests: ${ep.guests || '?'}`);

  // Limit very long transcripts (>500k chars)
  if (rawContent.length > 500000) {
    console.log(`  WARNING: Very long transcript, capping at 500k chars`);
    rawContent = rawContent.slice(0, 500000);
  }

  const hasASRLabels = /\[SPEAKER_\d+\]/.test(rawContent);
  const sys = makePrompt(ep.podcast_name, ep.host, ep.guests, ep.title, ep.description, hasASRLabels);

  // Chunk the transcript
  const lines = rawContent.split('\n');
  const chunks = []; let cur = '';
  for (const l of lines) {
    if (cur.length + l.length > CHUNK_SIZE && cur.length > 0) { chunks.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + l;
  }
  if (cur) chunks.push(cur);

  console.log(`  Chunks: ${chunks.length}`);

  // Polish each chunk with validation
  const results = [];
  let speakerCtx = '';
  let totalInputLen = 0, totalOutputLen = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    totalInputLen += chunk.length;

    const contextHint = i > 0 && speakerCtx
      ? `\n\n(${speakerCtx})`
      : '';

    let polished = null;
    let retries = 0;

    while (retries < MAX_RETRIES) {
      process.stdout.write(`  P${i+1}/${chunks.length} `);
      polished = await callLLMWithRetry([
        { role: 'system', content: sys },
        { role: 'user', content: chunk + contextHint }
      ]);

      if (!polished) {
        console.log('FAIL');
        retries++;
        await new Promise(r => setTimeout(r, 5000 * retries));
        continue;
      }

      // Validate output length
      const ratio = polished.length / chunk.length;
      if (ratio < MIN_OUTPUT_RATIO && chunk.length > 200) {
        process.stdout.write(`SHORT(${(ratio*100).toFixed(0)}%) `);
        retries++;
        if (retries < MAX_RETRIES) {
          process.stdout.write('retry... ');
          await new Promise(r => setTimeout(r, 3000 * retries));
          continue;
        }
        // On last retry, accept what we got
        console.log('WARN:accepting');
        break;
      } else {
        process.stdout.write(`OK(${(ratio*100).toFixed(0)}%) `);
        break;
      }
    }

    if (!polished) {
      console.log(`  WARN: chunk ${i+1} failed after ${MAX_RETRIES} retries, using original text`);
      polished = chunk; // Fall back to original text instead of failing whole episode
    }

    results.push(polished);
    totalOutputLen += polished.length;

    // Extract speaker names for context
    const names = new Set(); let m;
    const re = /\*\*\[([^\]]+)\]\*\*/g;
    while ((m = re.exec(polished)) !== null) names.add(m[1]);
    if (names.size > 0) speakerCtx = 'Use these exact speaker names: ' + [...names].join(', ');

    if ((i + 1) % 10 === 0) console.log('');
  }
  console.log('');

  const overallRatio = totalOutputLen / totalInputLen;
  console.log(`  Overall ratio: ${(overallRatio*100).toFixed(0)}% (${(totalInputLen/1000).toFixed(0)}k -> ${(totalOutputLen/1000).toFixed(0)}k)`);

  let content = results.join('\n\n');

  // Post-process inline
  // Fix format issues
  content = content.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*[：:]\s*/g, '$1**[$2]** ');
  content = content.replace(/(^|\n)\*\*([^*\[\]\n]{1,30}?)\*\*(\s)/g, (m, pre, name, sp) => pre + '**[' + name.trim() + ']**' + sp);
  content = content.replace(/\*\*\[([^\]]+)\]\s*\[(\d{1,3}:\d{2}(?::\d{2})?)\]\*\*/g, '**[$1]** [$2]');

  // Remove leaked LLM hints
  content = content.replace(/\(Part \d+\/\d+\..*?\)/g, '');
  content = content.replace(/\(Use these exact (?:speaker )?names:.*?\)/g, '');
  content = content.replace(/\(第\d+\/\d+段.*?\)/g, '');
  content = content.replace(/\(Speakers?:.*?\)/g, '');

  // Remove empty speaker-only lines
  content = content.replace(/^\*\*\[[^\]]+\]\*\*\s*$/gm, '').replace(/\n{3,}/g, '\n\n');

  // Replace generic labels with real names
  const tc = {}; const tre = /\*\*\[([^\]]+)\]\*\*/g; let tm;
  while ((tm = tre.exec(content)) !== null) tc[tm[1]] = (tc[tm[1]]||0)+1;
  const generic = ['嘉宾','Guest','嘉宾A','嘉宾B','Guest A','Guest B','对话者','受访者','访谈者',
                   'Interviewer','Interviewee','真名','RealName','说话人','Speaker','主持人','Host'];
  const real = Object.entries(tc).filter(([n])=>!generic.includes(n)).sort((a,b)=>b[1]-a[1]);

  // Replace generic host labels with actual host name
  if (ep.host && tc['主持人']) {
    content = content.replace(/\*\*\[主持人\]\*\*/g, `**[${ep.host}]**`);
  }
  if (ep.host && tc['Host']) {
    content = content.replace(/\*\*\[Host\]\*\*/g, `**[${ep.host}]**`);
  }

  // Replace other generic labels
  if (real.length >= 1) {
    for (const g of generic.filter(g => g !== '主持人' && g !== 'Host')) {
      if (tc[g]) {
        content = content.replace(new RegExp('\\*\\*\\['+g.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\]\\*\\*','g'), '**['+real[0][0]+']**');
      }
    }
  }

  // Count final speakers
  const finalTc = {};
  const fre = /\*\*\[([^\]]+)\]\*\*/g;
  while ((tm = fre.exec(content)) !== null) finalTc[tm[1]] = (finalTc[tm[1]]||0)+1;
  console.log(`  Speakers:`, finalTc);

  return content;
}

async function main() {
  const db = getDb();
  const start = Date.now();

  let episodeIds;

  if (specificEpisode) {
    episodeIds = [parseInt(specificEpisode)];
  } else {
    // Find all problematic Chinese polished transcripts
    const rows = db.prepare(`
      SELECT t.episode_id,
        LENGTH(t.content) as pol_len,
        (LENGTH(t.content) - LENGTH(REPLACE(t.content, '**[', ''))) / 3 as tags,
        LENGTH(t.content) / MAX(1, (LENGTH(t.content) - LENGTH(REPLACE(t.content, '**[', ''))) / 3) as avg_para,
        COALESCE(
          (SELECT LENGTH(content) FROM transcripts WHERE episode_id=t.episode_id AND source='asr' ORDER BY created_at DESC LIMIT 1),
          0
        ) as asr_len,
        e.title
      FROM transcripts t
      JOIN episodes e ON e.id = t.episode_id
      JOIN podcasts p ON p.id = e.podcast_id
      WHERE t.source = 'llm_polish' AND p.language = 'zh'
    `).all();

    // Filter to problematic ones
    episodeIds = rows
      .filter(r => {
        if (forceAll) return true;
        // Broken: too few speaker tags per content length
        if (r.avg_para > AVG_PARA_THRESHOLD) return true;
        // Incomplete: polish much shorter than ASR
        if (r.asr_len > 0 && r.pol_len < r.asr_len * 0.6) return true;
        // Empty or very short polish
        if (r.pol_len < 1000) return true;
        return false;
      })
      .sort((a, b) => b.avg_para - a.avg_para)
      .map(r => r.episode_id);

    // Deduplicate
    episodeIds = [...new Set(episodeIds)];

    // Also add episodes with ASR but no polish
    const noPolish = db.prepare(`
      SELECT DISTINCT t.episode_id
      FROM transcripts t
      JOIN episodes e ON e.id = t.episode_id
      JOIN podcasts p ON p.id = e.podcast_id
      WHERE t.source = 'asr' AND p.language = 'zh'
      AND t.episode_id NOT IN (SELECT episode_id FROM transcripts WHERE source = 'llm_polish')
      AND LENGTH(t.content) > 500
    `).all().map(r => r.episode_id);

    episodeIds = [...new Set([...episodeIds, ...noPolish])];
  }

  console.log(`\n=== Quality Re-polish: ${episodeIds.length} episodes ===\n`);

  if (dryRun) {
    for (const id of episodeIds) {
      const ep = db.prepare('SELECT title FROM episodes WHERE id=?').get(id);
      const pol = db.prepare("SELECT LENGTH(content) as len FROM transcripts WHERE episode_id=? AND source='llm_polish'").get(id);
      const asr = db.prepare("SELECT LENGTH(content) as len FROM transcripts WHERE episode_id=? AND source='asr' ORDER BY created_at DESC LIMIT 1").get(id);
      console.log(`  ep${id}: polish=${pol?.len || 0}, asr=${asr?.len || 0} - ${ep?.title?.slice(0, 60) || '?'}`);
    }
    console.log(`\nWould process ${episodeIds.length} episodes. Run without --dry-run to execute.`);
    closeDb();
    return;
  }

  let done = 0, failed = 0, skipped = 0;
  for (let i = 0; i < episodeIds.length; i++) {
    const epId = episodeIds[i];
    const elapsed = ((Date.now() - start) / 60000).toFixed(1);
    console.log(`\n[${i+1}/${episodeIds.length}] (${elapsed}m) Episode ${epId}`);

    try {
      const content = await polishEpisode(db, epId);
      if (!content) { skipped++; continue; }

      // Save
      const existing = db.prepare("SELECT id FROM transcripts WHERE episode_id=? AND source='llm_polish'").get(epId);
      if (existing) {
        db.prepare('UPDATE transcripts SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(content, existing.id);
        console.log(`  SAVED: updated existing (id=${existing.id}), ${(content.length/1000).toFixed(0)}k chars`);
      } else {
        db.prepare("INSERT INTO transcripts (episode_id, content, format, language, source) VALUES (?, ?, 'plain', 'zh', 'llm_polish')").run(epId, content);
        console.log(`  SAVED: created new polish, ${(content.length/1000).toFixed(0)}k chars`);
      }
      done++;
    } catch (e) {
      console.log(`  ERROR: ${e.message.slice(0, 100)}`);
      failed++;
    }
  }

  console.log(`\n=== Done in ${((Date.now() - start) / 60000).toFixed(1)}m: ${done} polished, ${failed} failed, ${skipped} skipped ===`);
  closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
