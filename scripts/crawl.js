#!/usr/bin/env node
/**
 * Podcast Transcript Crawler
 *
 * Strategy:
 * 1. Parse RSS feeds → import episode metadata + any inline transcripts
 * 2. For YouTube-linked episodes → fetch captions via YouTube innertube API
 * 3. For other episodes without transcripts → write to needs-asr.md
 */

const { getDb } = require('../server/src/db');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// ─── Known Chinese podcast RSS feeds ─────────────────────────────────────────
const PODCASTS = [
  {
    name: 'Lex Fridman Podcast',
    host: 'Lex Fridman',
    category: '科技',
    language: 'en',
    rss: 'https://lexfridman.com/feed/podcast/',
    website: 'https://lexfridman.com',
    description: 'AI, science, technology, history, philosophy and the human condition. Conversations with the most interesting people in the world.',
  },
  {
    name: 'a16z Podcast',
    host: 'Andreessen Horowitz',
    category: '科技',
    language: 'en',
    rss: 'https://feeds.simplecast.com/JGE3yC0V',
    website: 'https://a16z.com',
    description: 'Andreessen Horowitz discusses tech and culture trends shaping the future.',
  },
  {
    name: 'My First Million',
    host: 'Sam Parr & Shaan Puri',
    category: '创业',
    language: 'en',
    rss: 'https://feeds.megaphone.fm/HSW7835889191',
    website: 'https://www.mfmpod.com',
    description: 'Sam Parr and Shaan Puri discuss business ideas, trends, and how to build companies.',
  },
  {
    name: 'Planet Money',
    host: 'NPR',
    category: '商业',
    language: 'en',
    rss: 'https://feeds.npr.org/510289/podcast.xml',
    website: 'https://www.npr.org/sections/money',
    description: 'The economy explained. Imagine you could call up a friend who happens to have the same level of expertise as a Nobel Prize winning economist.',
  },
  {
    name: 'How I Built This',
    host: 'Guy Raz',
    category: '创业',
    language: 'en',
    rss: 'https://feeds.npr.org/510313/podcast.xml',
    website: 'https://www.npr.org/series/490248027/how-i-built-this',
    description: 'Guy Raz dives into the stories behind some of the world\'s best known companies.',
  },
  {
    name: 'Huberman Lab',
    host: 'Andrew Huberman',
    category: '科学',
    language: 'en',
    rss: 'https://feeds.megaphone.fm/hubermanlab',
    website: 'https://hubermanlab.com',
    description: 'Discusses neuroscience and practical tools to help you improve your health, performance and wellbeing.',
  },
  {
    name: 'This Week in Startups',
    host: 'Jason Calacanis',
    category: '创业',
    language: 'en',
    rss: 'https://feeds.simplecast.com/6WB3Yp3G',
    website: 'https://thisweekinstartups.com',
    description: 'Jason Calacanis and guests discuss the biggest startup and tech news of the week.',
  },
  {
    name: 'No Priors: AI x Tech Podcast',
    host: 'Sarah Guo & Elad Gil',
    category: '科技',
    language: 'en',
    rss: 'https://feeds.buzzsprout.com/2049929.rss',
    website: 'https://www.nopriorsai.com',
    description: 'A podcast about AI with Sarah Guo and Elad Gil.',
  },
  {
    name: 'The Knowledge Project',
    host: 'Shane Parrish',
    category: '商业',
    language: 'en',
    rss: 'https://feeds.transistor.fm/knowledge-project',
    website: 'https://fs.blog/knowledge-project-podcast/',
    description: 'Shane Parrish interviews world-class doers and thinkers so you can better lead organizations, people, and ultimately yourself.',
  },
  {
    name: 'My First Million',
    host: 'Sam Parr & Shaan Puri',
    category: '创业',
    language: 'en',
    rss: 'https://feeds.megaphone.fm/SPWPOD2992777',
    website: 'https://www.mfmpod.com',
    description: 'Sam Parr and Shaan Puri discuss business ideas, trends, and how to build companies.',
  },
  {
    name: '硅谷101',
    host: '徐涛',
    category: '科技',
    language: 'zh',
    rss: null, // 小宇宙专属，无公开RSS
    website: 'https://www.guiguyibai.com',
    description: '硅谷科技创业深度报道，探索科技行业最前沿的故事',
  },
  {
    name: '得到头条',
    host: '罗振宇',
    category: '商业',
    language: 'zh',
    rss: null, // 得到App专属内容
    website: 'https://www.dedao.cn',
    description: '得到App出品，每日科技商业精选',
  },
  {
    name: '商业就是这样',
    host: '吴伯凡',
    category: '商业',
    language: 'zh',
    rss: null, // 小宇宙，无公开RSS
    description: '商业洞察与认知升级',
  },
];

// ─── HTTP fetch helper ────────────────────────────────────────────────────────
function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const maxRedirects = options.maxRedirects ?? 5;
    if (maxRedirects === 0) return reject(new Error('Too many redirects'));

    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'PodScribe-Crawler/1.0 (podcast transcript indexer)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        ...options.headers,
      },
      timeout: 15000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return resolve(fetchUrl(res.headers.location, { ...options, maxRedirects: maxRedirects - 1 }));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

// ─── XML helpers ─────────────────────────────────────────────────────────────
function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeCdata(match[1].trim()) : '';
}

function extractTagAll(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const results = [];
  let m;
  while ((m = re.exec(xml))) results.push(decodeCdata(m[1].trim()));
  return results;
}

function extractAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"[^>]*>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}

function splitItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) items.push(m[1]);
  return items;
}

function decodeCdata(str) {
  return str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, (_, c) => c).trim();
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return null;
}

// ─── YouTube transcript fetcher (via yt-dlp) ─────────────────────────────────

async function fetchYouTubeTranscript(videoId, lang = 'en') {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podscribe-'));
  const outTemplate = path.join(tmpDir, '%(id)s');

  try {
    // Try manual captions first, then auto
    for (const subFlag of ['--write-sub', '--write-auto-sub']) {
      const result = spawnSync('yt-dlp', [
        subFlag,
        '--sub-lang', lang,
        '--sub-format', 'vtt',
        '--skip-download',
        '--no-playlist',
        '--quiet',
        '-o', outTemplate,
        `https://www.youtube.com/watch?v=${videoId}`,
      ], { timeout: 30000, encoding: 'utf8' });

      // Find downloaded VTT file
      const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.vtt'));
      if (files.length > 0) {
        const vttContent = fs.readFileSync(path.join(tmpDir, files[0]), 'utf8');
        if (vttContent.length > 200) {
          return {
            content: vttContent,
            format: 'vtt',
            language: lang,
            isAuto: subFlag === '--write-auto-sub',
          };
        }
      }
    }

    return null;
  } catch (err) {
    return null;
  } finally {
    // Clean up temp directory
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  }
}

// Extract YouTube video ID from URL
function extractYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ─── RSS feed parser ──────────────────────────────────────────────────────────
async function parseFeed(feedUrl, podcastMeta) {
  console.log(`  Fetching RSS: ${feedUrl}`);
  let resp;
  try {
    resp = await fetchUrl(feedUrl);
  } catch (err) {
    console.log(`  ✗ Fetch failed: ${err.message}`);
    return [];
  }

  if (resp.status !== 200) {
    console.log(`  ✗ HTTP ${resp.status}`);
    return [];
  }

  const xml = resp.body;
  const episodes = [];
  const items = splitItems(xml);

  for (const item of items.slice(0, 20)) { // limit to 20 most recent
    const title = stripHtml(extractTag(item, 'title'));
    const description = stripHtml(extractTag(item, 'description') || extractTag(item, 'itunes:summary') || '');
    const pubDate = parseDate(extractTag(item, 'pubDate') || extractTag(item, 'published') || extractTag(item, 'dc:date'));
    const link = extractTag(item, 'link') || extractAttr(item, 'enclosure', 'url') || '';
    const enclosureUrl = extractAttr(item, 'enclosure', 'url');
    const duration = extractTag(item, 'itunes:duration') || '';
    const guests = extractTag(item, 'itunes:subtitle') || '';

    // Find any YouTube links in the item
    const allUrls = (item.match(/https?:\/\/[^\s"<>]+/g) || []);
    const ytLink = allUrls.find(u => extractYouTubeId(u));
    const audioUrl = enclosureUrl || allUrls.find(u => u.match(/\.mp3|\.m4a|\.ogg/i)) || '';

    if (!title) continue;

    episodes.push({
      title,
      description: description.slice(0, 500),
      published_date: pubDate,
      episode_url: link || enclosureUrl || '',
      audio_url: audioUrl,
      duration: parseDuration(duration),
      guests: guests.slice(0, 200),
      youtube_id: extractYouTubeId(ytLink || link || ''),
    });
  }

  return episodes;
}

function parseDuration(str) {
  if (!str) return null;
  // "HH:MM:SS" or "MM:SS" or just seconds
  const parts = str.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1 && !isNaN(parts[0])) return parts[0];
  return null;
}

// ─── Database helpers ─────────────────────────────────────────────────────────
function upsertPodcast(db, meta) {
  const existing = db.prepare('SELECT id FROM podcasts WHERE name = ?').get(meta.name);
  if (existing) return existing.id;

  const result = db.prepare(`
    INSERT INTO podcasts (name, host, description, website_url, rss_url, category, language, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(meta.name, meta.host || '', meta.description || '', meta.website || '', meta.rss || '', meta.category || '综合', meta.language || 'zh', meta.image_url || '');

  return result.lastInsertRowid;
}

function upsertEpisode(db, podcastId, ep) {
  // Check if episode with same URL already exists
  if (ep.episode_url) {
    const existing = db.prepare('SELECT id FROM episodes WHERE episode_url = ?').get(ep.episode_url);
    if (existing) return { id: existing.id, isNew: false };
  }
  // Check by title + podcast
  const existingByTitle = db.prepare('SELECT id FROM episodes WHERE podcast_id = ? AND title = ?').get(podcastId, ep.title);
  if (existingByTitle) return { id: existingByTitle.id, isNew: false };

  const result = db.prepare(`
    INSERT INTO episodes (podcast_id, title, description, published_date, audio_url, episode_url, duration, guests)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(podcastId, ep.title, ep.description || '', ep.published_date || null, ep.audio_url || '', ep.episode_url || '', ep.duration || null, ep.guests || '');

  return { id: result.lastInsertRowid, isNew: true };
}

function hasTranscript(db, episodeId) {
  return !!db.prepare('SELECT id FROM transcripts WHERE episode_id = ?').get(episodeId);
}

function insertTranscript(db, episodeId, content, format, language, source) {
  db.prepare(`
    INSERT OR REPLACE INTO transcripts (episode_id, content, format, language, source)
    VALUES (?, ?, ?, ?, ?)
  `).run(episodeId, content, format, language || 'zh', source || 'crawl');
}

// ─── YouTube channel crawler ──────────────────────────────────────────────────
async function fetchYouTubeChannelVideos(channelHandle, maxVideos = 10) {
  const url = `https://www.youtube.com/@${channelHandle}/videos`;
  const resp = await fetchUrl(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+294; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg',
    }
  });
  if (resp.status !== 200) return [];

  // Extract video IDs and titles from ytInitialData
  const dataMatch = resp.body.match(/ytInitialData\s*=\s*(\{.+?\});\s*(?:window\[|var\s+\w+|<\/script)/s);
  if (!dataMatch) return [];

  let data;
  try { data = JSON.parse(dataMatch[1]); } catch { return []; }

  const videos = [];
  const richItems = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[1]?.tabRenderer?.content
    ?.richGridRenderer?.contents || [];

  for (const item of richItems) {
    const video = item?.richItemRenderer?.content?.videoRenderer;
    if (!video?.videoId) continue;
    const title = video.title?.runs?.map(r => r.text).join('') || '';
    const publishedText = video.publishedTimeText?.simpleText || '';
    const duration = video.lengthText?.simpleText || '';
    if (title) {
      videos.push({ videoId: video.videoId, title, publishedText, duration });
    }
    if (videos.length >= maxVideos) break;
  }

  return videos;
}

async function crawlYouTubeChannel(db, podcastMeta, channelHandle, lang = 'en') {
  console.log(`  Fetching YouTube channel: @${channelHandle}`);
  const podcastId = upsertPodcast(db, podcastMeta);
  const videos = await fetchYouTubeChannelVideos(channelHandle, 10);
  console.log(`  Found ${videos.length} videos`);

  const results = { newEpisodes: 0, newTranscripts: 0, needsAsr: [] };

  for (const video of videos) {
    const epData = {
      title: video.title,
      description: '',
      episode_url: `https://www.youtube.com/watch?v=${video.videoId}`,
      audio_url: '',
      youtube_id: video.videoId,
      published_date: null,
      duration: null,
      guests: '',
    };

    const { id: episodeId, isNew } = upsertEpisode(db, podcastId, epData);
    if (isNew) results.newEpisodes++;

    if (hasTranscript(db, episodeId)) continue;

    console.log(`  ⟳ Fetching YouTube transcript: ${video.title.slice(0, 50)}...`);
    const yt = await fetchYouTubeTranscript(video.videoId, lang);
    if (yt && yt.content && yt.content.length > 200) {
      insertTranscript(db, episodeId, yt.content, yt.format, yt.language, 'youtube_captions');
      results.newTranscripts++;
      console.log(`  ✓ [youtube ${yt.isAuto ? 'auto' : 'manual'}] ${video.title.slice(0, 60)}`);
    } else {
      results.needsAsr.push({
        podcast: podcastMeta.name,
        host: podcastMeta.host,
        category: podcastMeta.category,
        episode: video.title,
        episode_url: epData.episode_url,
        youtube_id: video.videoId,
        reason: 'YouTube transcript unavailable',
        action: 'Run ASR on audio',
      });
    }
  }

  return results;
}

// ─── YouTube-native podcasts (channel-based crawl) ────────────────────────────
const YOUTUBE_PODCASTS = [
  {
    name: 'Lex Fridman Podcast',
    host: 'Lex Fridman',
    category: '科技',
    language: 'en',
    channelHandle: 'lexfridman',
    website: 'https://lexfridman.com',
    description: 'Conversations with the most interesting people in the world about science, technology, history, philosophy, and the nature of intelligence, consciousness, love, and power.',
  },
];

// ─── Main crawler ─────────────────────────────────────────────────────────────
async function main() {
  const db = getDb();
  const needsAsr = [];
  let totalNew = 0;
  let totalTranscripts = 0;

  console.log('🎙️  PodScribe Crawler starting...\n');

  for (const podcastMeta of PODCASTS) {
    console.log(`\n📻 ${podcastMeta.name} (${podcastMeta.host})`);

    // Skip podcasts without RSS (will be handled manually / needs ASR)
    if (!podcastMeta.rss) {
      needsAsr.push({
        podcast: podcastMeta.name,
        host: podcastMeta.host,
        category: podcastMeta.category,
        reason: 'No RSS feed found',
        action: 'Find RSS feed or use ASR',
        platform: '小宇宙/喜马拉雅',
      });
      continue;
    }

    // Ensure podcast exists in DB
    const podcastId = upsertPodcast(db, podcastMeta);

    // Fetch episodes from RSS
    const episodes = await parseFeed(podcastMeta.rss, podcastMeta);
    console.log(`  Found ${episodes.length} episodes in RSS`);

    for (const ep of episodes) {
      const { id: episodeId, isNew } = upsertEpisode(db, podcastId, ep);
      if (isNew) totalNew++;

      if (hasTranscript(db, episodeId)) {
        if (isNew) console.log(`  ✓ [existing transcript] ${ep.title.slice(0, 60)}`);
        continue;
      }

      // Try YouTube transcript first
      const ytId = ep.youtube_id;
      if (ytId) {
        console.log(`  ⟳ Fetching YouTube transcript for: ${ep.title.slice(0, 50)}...`);
        try {
          const yt = await fetchYouTubeTranscript(ytId, podcastMeta.language === 'zh' ? 'zh-Hans' : 'en');
          if (yt && yt.content && yt.content.length > 200) {
            insertTranscript(db, episodeId, yt.content, yt.format, yt.language, 'youtube_captions');
            totalTranscripts++;
            console.log(`  ✓ [youtube ${yt.isAuto ? 'auto' : 'manual'}] ${ep.title.slice(0, 60)}`);
            continue;
          }
        } catch (err) {
          console.log(`  ✗ YouTube failed: ${err.message}`);
        }
      }

      // No transcript available - add to ASR needs list
      needsAsr.push({
        podcast: podcastMeta.name,
        host: podcastMeta.host,
        category: podcastMeta.category,
        episode: ep.title,
        episode_url: ep.episode_url || ep.audio_url || '',
        audio_url: ep.audio_url || '',
        published_date: ep.published_date || '',
        youtube_id: ytId || '',
        reason: ytId ? 'YouTube transcript unavailable (no captions)' : 'Audio only - needs ASR',
        action: ytId ? 'Run ASR on audio or wait for YouTube auto-captions' : 'Run Whisper ASR on audio file',
      });
    }

    // Small delay to be respectful
    await new Promise(r => setTimeout(r, 500));
  }

  // ─── Phase 2: YouTube channel-based podcasts ───────────────────────────────
  console.log('\n─── Phase 2: YouTube Channel Podcasts ───────────────────────\n');
  for (const yt of YOUTUBE_PODCASTS) {
    console.log(`\n📺 ${yt.name} (@${yt.channelHandle})`);
    try {
      const r = await crawlYouTubeChannel(db, yt, yt.channelHandle, yt.language === 'zh' ? 'zh-Hans' : 'en');
      totalNew += r.newEpisodes;
      totalTranscripts += r.newTranscripts;
      needsAsr.push(...r.needsAsr);
    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // Also check known Chinese podcast platforms without RSS
  const manualPlatforms = [
    { name: '小宇宙 (xiaoyuzhou.fm)', description: '国内最大中文播客平台，无公开RSS/API，需要OCR或ASR处理', action: 'Use EchoShell Chrome extension with ASR to capture audio' },
    { name: '喜马拉雅 (ximalaya.com)', description: '综合音频平台，部分节目有自动字幕，需通过API或ASR提取', action: 'Check individual episode pages for auto-captions, or use ASR' },
    { name: '荔枝播客 (lizhi.fm)', description: '中文播客平台，无统一字幕系统', action: 'Use ASR on audio files' },
    { name: '网易云音乐播客', description: '网易云音乐播客区，无字幕系统', action: 'Use ASR on audio files' },
    { name: '得到App播客', description: '得到App专属内容，有AI转录功能但不开放', action: 'Use EchoShell to capture and transcribe while listening' },
    { name: 'Spotify Podcasts (中文)', description: '部分中文节目有Spotify自动转录，需登录访问', action: 'Use Spotify API with OAuth or manual capture' },
  ];

  // ─── Write needs-asr.md report ────────────────────────────────────────────
  const reportPath = path.join(__dirname, '../needs-asr.md');
  const now = new Date().toISOString().split('T')[0];

  let report = `# 播客文稿待处理报告
*Generated: ${now}*

## 概述

以下播客/节目缺少文字稿，需要通过 ASR（自动语音识别）或 OCR 进一步处理。

**统计**:
- 已爬取新节目: ${totalNew}
- 已导入文字稿: ${totalTranscripts}
- 待处理节目数: ${needsAsr.length}

---

## 一、已知中文播客平台（无公开文稿接口）

这些平台无法自动爬取文字稿，建议使用 **EchoShell Chrome插件** 在收听时实时转录。

| 平台 | 说明 | 建议操作 |
|------|------|----------|
${manualPlatforms.map(p => `| **${p.name}** | ${p.description} | ${p.action} |`).join('\n')}

---

## 二、RSS已收录但无文字稿的节目

以下节目已通过RSS收录到数据库，但没有找到可用的文字稿：

`;

  // Group by podcast
  const byPodcast = {};
  for (const item of needsAsr) {
    if (!item.episode) continue; // skip podcast-level entries (handled above)
    if (!byPodcast[item.podcast]) byPodcast[item.podcast] = [];
    byPodcast[item.podcast].push(item);
  }

  for (const [podcastName, items] of Object.entries(byPodcast)) {
    report += `### ${podcastName}\n\n`;
    report += `| 节目标题 | 发布日期 | 原因 | 建议操作 |\n`;
    report += `|----------|----------|------|----------|\n`;
    for (const item of items.slice(0, 10)) {
      const title = item.episode?.slice(0, 50) || '';
      const url = item.audio_url || item.episode_url || '';
      const titleLink = url ? `[${title}](${url})` : title;
      report += `| ${titleLink} | ${item.published_date || 'N/A'} | ${item.reason} | ${item.action} |\n`;
    }
    if (items.length > 10) report += `\n*... 及其他 ${items.length - 10} 个节目*\n`;
    report += '\n';
  }

  report += `---

## 三、推荐 ASR 工具

### 本地工具
- **Whisper** (OpenAI): \`whisper audio.mp3 --language zh --model medium\`
- **faster-whisper**: GPU加速版本，适合批量处理
- **whisper.cpp**: C++实现，CPU高效运行

### 云端 API
- **OpenAI Whisper API**: \`POST https://api.openai.com/v1/audio/transcriptions\`
- **Groq Whisper**: 免费额度大，速度快
- **Deepgram**: 支持中文，实时转录

### EchoShell 集成
EchoShell Chrome 插件已集成 BYOK ASR，可在收听播客时实时转录并上传到本 Forum。
- Forum 上传接口: \`POST /api/upload\`
- 查重接口: \`GET /api/check?url=<episode_url>\`

---

## 四、批量 ASR 脚本示例

\`\`\`bash
# 使用 Whisper 批量转录音频文件
for mp3 in *.mp3; do
  whisper "$mp3" \\
    --language zh \\
    --model medium \\
    --output_format vtt \\
    --output_dir transcripts/
done
\`\`\`

\`\`\`bash
# 使用 Groq API 批量转录 (更快)
for mp3 in *.mp3; do
  curl -X POST https://api.groq.com/openai/v1/audio/transcriptions \\
    -H "Authorization: Bearer $GROQ_API_KEY" \\
    -F "file=@$mp3" \\
    -F "model=whisper-large-v3" \\
    -F "language=zh" \\
    -F "response_format=vtt"
done
\`\`\`
`;

  fs.writeFileSync(reportPath, report, 'utf8');

  console.log('\n─────────────────────────────────────────');
  console.log(`✅ Crawler complete:`);
  console.log(`   New episodes imported : ${totalNew}`);
  console.log(`   Transcripts fetched   : ${totalTranscripts}`);
  console.log(`   Needs ASR/OCR         : ${needsAsr.length}`);
  console.log(`   Report written to     : needs-asr.md`);
  console.log('─────────────────────────────────────────\n');
}

main().catch(err => {
  console.error('Crawler error:', err);
  process.exit(1);
});
