#!/usr/bin/env node
/**
 * PodScribe Comprehensive Podcast Crawler
 *
 * Strategy:
 * 1. YouTube channels → yt-dlp for captions (highest priority)
 * 2. RSS feeds → episode metadata + audio URLs
 * 3. Cross-reference: check if RSS episodes have YouTube equivalents
 * 4. Generate needs-asr.md for episodes without transcripts
 */

const { getDb } = require('../server/src/db');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// ─── Podcast catalog ──────────────────────────────────────────────────────────

// YouTube channels (yt-dlp will attempt caption download for all)
const YOUTUBE_CHANNELS = [
  // ════ PRIORITY: 张小珺 / 罗永浩 / WhynotTV ════
  {
    name: '张小珺Jùn｜商业访谈录',
    host: '张小珺',
    category: '商业',
    language: 'zh',
    channelId: 'UC3Sv1JuKpbOx3csUO8FAo5g',
    website: 'https://www.xiaoyuzhoufm.com/podcast/5e280fab418a84a04615ded1',
    description: '张小珺的深度商业访谈，聚焦科技创业、硅谷和商业故事。',
  },
  {
    name: '罗永浩的十字路口',
    host: '罗永浩',
    category: '科技',
    language: 'zh',
    channelId: 'UC33VP_gIBzCVcEvaGKBocZA',
    website: 'https://www.xiaoyuzhoufm.com/podcast/68981df29e7bcd326eb91d88',
    description: '罗永浩主持的深度对话节目，每集3-5小时，聚焦科技与人文。',
  },
  {
    name: 'WhynotTV',
    host: 'WhynotTV',
    category: '科技',
    language: 'zh',
    channelId: 'UC5xLV_gJAP9psKcyrJ3ZIcw',
    website: 'https://www.youtube.com/@WhynotTV',
    description: '深度访谈AI/ML研究者和技术创业者，聚焦前沿技术与产业实践。',
  },
  // ════ 中文科技商业播客 ════
  {
    name: '硅谷101',
    host: '潘乔',
    category: '科技',
    language: 'zh',
    channelId: 'UChnNjLyx_5rk_iDPQ2BQDQA',
    website: 'https://sv101.fireside.fm',
    description: '探讨硅谷科技公司、创始人及其背后的故事，深度访谈与产业分析。',
  },
  {
    name: '不明白播客',
    host: '李如一 方可成',
    category: '文化',
    language: 'zh',
    channelId: 'UCAf2O_wWu1YCS9YLUqnyqDA',
    website: 'https://www.bumingbai.net',
    description: '讨论中国与世界的政治、经济、文化现象，探寻背后的逻辑。',
  },
  {
    name: '极客公园',
    host: '张鹏',
    category: '科技',
    language: 'zh',
    channelId: 'UC0ODRMH3NDXiTHO2537576Q',
    website: 'https://www.geekpark.net',
    description: '中国领先的科技媒体，报道科技创业、产品和行业趋势。',
  },
  {
    name: '造就 Talks',
    host: '造就',
    category: '科学',
    language: 'zh',
    channelId: 'UCGuCdprCemPPG6664S8zlfw',
    website: 'https://www.zaojiu.com',
    description: '中国版TED，聚焦科学、技术、设计和创业领域的演讲。',
  },
  {
    name: '海外独角兽',
    host: '海外独角兽',
    category: '科技',
    language: 'zh',
    channelId: 'UCexCmbMnndY9FANqrPdj3XQ',
    website: 'https://www.xiaoyuzhoufm.com/podcast/5f8c7fc5b5159a3d4b7c9034',
    description: '聚焦出海创业、全球科技趋势，帮助中国创业者走向世界。',
  },
  // ════ 英文科技播客 (YouTube) ════
  {
    name: 'Lex Fridman Podcast',
    host: 'Lex Fridman',
    category: '科技',
    language: 'en',
    channelId: 'UCSHZKyawb77ixDdsGog4iWA',
    website: 'https://lexfridman.com',
    description: 'Conversations with scientists, engineers, artists, and entrepreneurs about the nature of intelligence and existence.',
  },
  {
    name: 'Y Combinator',
    host: 'Y Combinator',
    category: '创业',
    language: 'en',
    channelId: 'UCcefcZRL2oaA_uBNeo5UNqg',
    website: 'https://www.ycombinator.com',
    description: 'Talks by YC founders, partners and alumni about startups, technology and entrepreneurship.',
  },
  {
    name: 'TED',
    host: 'TED',
    category: '科学',
    language: 'en',
    channelId: 'UCAuUUnT6oDeKwE6v1NGQxug',
    website: 'https://www.ted.com',
    description: 'TED Talks covering technology, entertainment, design, science, culture and more.',
  },
  {
    name: 'a16z Podcast (YouTube)',
    host: 'Andreessen Horowitz',
    category: '科技',
    language: 'en',
    channelId: 'UC9cn-afUaOuGkMjvcQD1qyA',
    website: 'https://a16z.com',
    description: 'a16z partners discuss technology and culture trends shaping the future.',
  },
  {
    name: 'Dwarkesh Podcast',
    host: 'Dwarkesh Patel',
    category: '科技',
    language: 'en',
    channelId: 'UCak-dNJXPetPGCfcR0E0m-w',
    website: 'https://www.dwarkeshpatel.com',
    description: 'Long-form conversations with scientists, economists, historians and technologists.',
  },
  {
    name: 'TBPN (The Breakfast Podcast Network)',
    host: 'Various',
    category: '科技',
    language: 'en',
    channelId: 'UCGHrfnLGX5d9tmMBm4EKr-g',
    website: 'https://www.youtube.com/@TBPN',
    description: 'Daily tech news and startup discussion.',
  },
];

// RSS-based podcasts (metadata + audio, no transcripts usually)
const RSS_PODCASTS = [
  // ════ 小宇宙 中文播客 (xyzfm.space feeds) ════
  {
    name: '张小珺Jùn｜商业访谈录',
    host: '张小珺',
    category: '商业',
    language: 'zh',
    rss: 'https://feed.xyzfm.space/dk4yh3pkpjp3',
    website: 'https://www.xiaoyuzhoufm.com/podcast/5e280fab418a84a04615ded1',
    description: '张小珺的深度商业访谈，聚焦科技创业、硅谷和商业故事。',
  },
  {
    name: '罗永浩的十字路口',
    host: '罗永浩',
    category: '科技',
    language: 'zh',
    rss: 'https://feed.xyzfm.space/wmnkvmrpwuww',
    website: 'https://www.xiaoyuzhoufm.com/podcast/68981df29e7bcd326eb91d88',
    description: '罗永浩主持的深度对话，每集3-5小时，聚焦科技与人文。',
  },
  {
    name: 'OnBoard!',
    host: 'Monica&Edward',
    category: '创业',
    language: 'zh',
    rss: 'https://feed.xyzfm.space/xxg7ryklkkft',
    website: 'https://www.xiaoyuzhoufm.com/podcast/61aab45de7c4e2218b73e012',
    description: '和硅谷、中国顶级创始人和投资人一起，聊创业与投资的第一现场。',
  },
  {
    name: '海外独角兽',
    host: '海外独角兽',
    category: '科技',
    language: 'zh',
    rss: 'https://feed.xyzfm.space/ym6ug8jctfp8',
    website: 'https://www.xiaoyuzhoufm.com/podcast/5f8c7fc5b5159a3d4b7c9034',
    description: '聚焦出海创业和全球科技，帮助中国创业者走向世界。',
  },
  {
    name: '声东击西',
    host: '徐涛',
    category: '科技',
    language: 'zh',
    rss: 'https://feeds.fireside.fm/shengdongjixi/rss',
    website: 'https://etw.fm',
    description: '用独特视角发现科技与商业背后的故事。',
  },
  {
    name: '硅谷101',
    host: '潘乔',
    category: '科技',
    language: 'zh',
    rss: 'https://sv101.fireside.fm/rss',
    website: 'https://sv101.fireside.fm',
    description: '探讨硅谷科技公司、创始人及其背后的故事。',
  },
  {
    name: '创业内幕',
    host: '王思远',
    category: '创业',
    language: 'zh',
    rss: null, // 小宇宙，无稳定RSS
    description: '深度访谈中国最顶尖的创业者，还原真实的创业故事。',
  },
  {
    name: '科技早知道',
    host: 'Signal',
    category: '科技',
    language: 'zh',
    rss: null, // 小宇宙，无稳定RSS
    description: '解读全球科技前沿动态，关注AI、芯片、互联网等领域。',
  },
  // ════ 英文播客 RSS ════
  {
    name: 'Lex Fridman Podcast',
    host: 'Lex Fridman',
    category: '科技',
    language: 'en',
    rss: 'https://lexfridman.com/feed/podcast/',
    website: 'https://lexfridman.com',
    description: 'AI, science, technology, history, philosophy and the human condition.',
  },
  {
    name: 'Huberman Lab',
    host: 'Andrew Huberman',
    category: '科学',
    language: 'en',
    rss: 'https://feeds.megaphone.fm/hubermanlab',
    website: 'https://hubermanlab.com',
    description: 'Science-based tools for everyday life — neuroscience, health and performance.',
  },
  {
    name: 'Planet Money',
    host: 'NPR',
    category: '商业',
    language: 'en',
    rss: 'https://feeds.npr.org/510289/podcast.xml',
    website: 'https://www.npr.org/sections/money',
    description: 'The economy explained in accessible, entertaining stories.',
  },
  {
    name: 'How I Built This',
    host: 'Guy Raz',
    category: '创业',
    language: 'en',
    rss: 'https://feeds.npr.org/510313/podcast.xml',
    website: 'https://www.npr.org/series/490248027/how-i-built-this',
    description: 'Stories behind the world\'s best-known companies and the people who built them.',
  },
  {
    name: 'No Priors: AI x Tech Podcast',
    host: 'Sarah Guo & Elad Gil',
    category: '科技',
    language: 'en',
    rss: 'https://feeds.buzzsprout.com/2049929.rss',
    website: 'https://www.nopriorsai.com',
    description: 'AI and tech with Sarah Guo and Elad Gil.',
  },
  {
    name: 'The Knowledge Project',
    host: 'Shane Parrish',
    category: '商业',
    language: 'en',
    rss: 'https://feeds.transistor.fm/knowledge-project',
    website: 'https://fs.blog/knowledge-project-podcast/',
    description: 'Interviews on mental models, decision making, and how the world works.',
  },
  {
    name: 'Dwarkesh Podcast',
    host: 'Dwarkesh Patel',
    category: '科技',
    language: 'en',
    rss: 'https://feeds.transistor.fm/lunar-society',
    website: 'https://www.dwarkeshpatel.com',
    description: 'Long-form conversations with leading scientists, economists and technologists.',
  },
];

// Known platforms without transcripts (for ASR needs doc)
const MANUAL_PLATFORMS = [
  { name: '小宇宙 (xiaoyuzhou.fm)', desc: '国内最大中文播客平台，无公开API/转录。建议使用EchoShell实时转录。', action: 'EchoShell Chrome Extension (ASR mode)' },
  { name: '喜马拉雅 (ximalaya.com)', desc: '综合音频平台，部分节目有自动字幕。', action: '检查各节目页面是否有字幕，或用ASR' },
  { name: '荔枝播客 (lizhi.fm)', desc: '中文播客平台，无字幕系统。', action: 'Whisper ASR on audio' },
  { name: 'Spotify Podcasts', desc: '部分节目有AI转录，需OAuth登录。', action: 'Spotify API (需授权) 或 EchoShell' },
  { name: '网易云音乐播客', desc: '无字幕系统。', action: 'Whisper ASR on audio' },
  { name: '得到App', desc: '专属内容，有AI转录但不开放。', action: 'EchoShell边听边转录' },
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
      timeout: 20000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return resolve(fetchUrl(res.headers.location, { ...options, maxRedirects: maxRedirects - 1 }));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ─── XML / RSS helpers ────────────────────────────────────────────────────────
function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? decodeCdata(m[1].trim()) : '';
}
function extractAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i'));
  return m ? m[1] : '';
}
function splitItems(xml) {
  const re = /<item>([\s\S]*?)<\/item>/gi;
  const items = [];
  let m;
  while ((m = re.exec(xml))) items.push(m[1]);
  return items;
}
function decodeCdata(str) {
  return str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, (_, c) => c)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}
function stripHtml(str) {
  return str.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}
function parseDuration(str) {
  if (!str) return null;
  const p = str.split(':').map(Number);
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  if (!isNaN(p[0])) return p[0];
  return null;
}
function extractYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ─── RSS feed parser ──────────────────────────────────────────────────────────
async function parseFeed(feedUrl, limit = 50) {
  let resp;
  try { resp = await fetchUrl(feedUrl); } catch (e) { return { ok: false, error: e.message, episodes: [] }; }
  if (resp.status !== 200) return { ok: false, error: `HTTP ${resp.status}`, episodes: [] };

  const xml = resp.body;
  const items = splitItems(xml);
  const episodes = [];

  for (const item of items.slice(0, limit)) {
    const title = stripHtml(extractTag(item, 'title'));
    if (!title) continue;
    const desc = stripHtml(extractTag(item, 'description') || extractTag(item, 'itunes:summary') || '');
    const pubDate = parseDate(extractTag(item, 'pubDate') || extractTag(item, 'dc:date') || '');
    const link = extractTag(item, 'link') || '';
    const enclosureUrl = extractAttr(item, 'enclosure', 'url');
    const duration = parseDuration(extractTag(item, 'itunes:duration') || '');
    const guests = extractTag(item, 'itunes:subtitle') || '';
    // Check for podcast:transcript
    const transcriptUrl = extractAttr(item, 'podcast:transcript', 'url') ||
      extractAttr(item, 'transcript', 'url') || '';
    const transcriptType = extractAttr(item, 'podcast:transcript', 'type') || '';
    // Find YouTube links
    const allUrls = (item.match(/https?:\/\/[^\s"<>]+/g) || []);
    const ytId = extractYouTubeId(allUrls.find(u => extractYouTubeId(u)) || link || '');
    const audioUrl = enclosureUrl || allUrls.find(u => /\.(mp3|m4a|ogg|wav|aac)(\?|$)/i.test(u)) || '';

    episodes.push({ title, description: desc.slice(0, 600), published_date: pubDate,
      episode_url: link || enclosureUrl || '', audio_url: audioUrl, duration,
      guests: guests.slice(0, 200), youtube_id: ytId,
      transcript_url: transcriptUrl, transcript_type: transcriptType });
  }
  return { ok: true, episodes };
}

// ─── YouTube helpers ──────────────────────────────────────────────────────────
function ytDlp(args, opts = {}) {
  return spawnSync('yt-dlp', args, {
    timeout: opts.timeout || 60000,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function getChannelVideos(channelId, maxVideos = 50) {
  const result = ytDlp([
    '--flat-playlist', '--get-id', '--get-title',
    '--playlist-end', String(maxVideos),
    '--no-playlist', '--quiet',
    `https://www.youtube.com/channel/${channelId}`,
  ], { timeout: 120000 });

  if (result.status !== 0) return [];
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  const videos = [];
  for (let i = 0; i < lines.length - 1; i += 2) {
    // yt-dlp --get-title --get-id interleaves title/id
    // but actually with --get-id only it gives ids; with both it depends on version
    // Let's handle both cases
    if (lines[i].match(/^[A-Za-z0-9_-]{11}$/)) {
      videos.push({ videoId: lines[i], title: lines[i + 1] || '' });
    } else {
      videos.push({ title: lines[i], videoId: lines[i + 1] || '' });
    }
  }
  // Filter invalid
  return videos.filter(v => v.videoId && v.videoId.match(/^[A-Za-z0-9_-]{11}$/));
}

function downloadCaption(videoId, lang = 'en', tmpDir) {
  const outTemplate = path.join(tmpDir, '%(id)s');
  // Try manual subtitles first, then auto
  for (const flag of ['--write-sub', '--write-auto-sub']) {
    const result = ytDlp([
      flag, '--sub-lang', lang, '--sub-format', 'vtt',
      '--skip-download', '--no-playlist', '--quiet',
      '-o', outTemplate,
      `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeout: 45000 });

    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.vtt'));
    if (files.length > 0) {
      const content = fs.readFileSync(path.join(tmpDir, files[0]), 'utf8');
      // Clean up for next attempt
      files.forEach(f => fs.unlinkSync(path.join(tmpDir, f)));
      if (content.length > 500) {
        return { content, language: lang, isAuto: flag === '--write-auto-sub' };
      }
    }
  }
  return null;
}

function getVideoMetadata(videoId) {
  const result = ytDlp([
    '--print', 'title', '--print', 'upload_date', '--print', 'duration',
    '--print', 'description', '--no-playlist', '--quiet',
    `https://www.youtube.com/watch?v=${videoId}`,
  ], { timeout: 30000 });
  if (result.status !== 0) return null;
  const [title, date, duration, ...descLines] = result.stdout.trim().split('\n');
  const parsedDate = date ? `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}` : null;
  return {
    title: title?.trim() || '',
    published_date: parsedDate,
    duration: duration ? parseInt(duration) : null,
    description: descLines.join('\n').slice(0, 600),
  };
}

// ─── Database helpers ─────────────────────────────────────────────────────────
function upsertPodcast(db, meta) {
  const existing = db.prepare('SELECT id FROM podcasts WHERE name = ?').get(meta.name);
  if (existing) {
    // Update website/rss if newly available
    if (meta.website || meta.rss) {
      db.prepare('UPDATE podcasts SET website_url = COALESCE(website_url, ?), rss_url = COALESCE(rss_url, ?) WHERE id = ?')
        .run(meta.website || null, meta.rss || null, existing.id);
    }
    return existing.id;
  }
  const r = db.prepare(`
    INSERT INTO podcasts (name, host, description, website_url, rss_url, category, language, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(meta.name, meta.host || '', meta.description || '',
    meta.website || null, meta.rss || null,
    meta.category || '综合', meta.language || 'zh', meta.image_url || null);
  return r.lastInsertRowid;
}

function upsertEpisode(db, podcastId, ep) {
  // Dedup by episode_url first
  if (ep.episode_url) {
    const existing = db.prepare('SELECT id FROM episodes WHERE episode_url = ?').get(ep.episode_url);
    if (existing) return { id: existing.id, isNew: false };
  }
  // Dedup by title+podcast
  const existingByTitle = db.prepare('SELECT id FROM episodes WHERE podcast_id = ? AND title = ?').get(podcastId, ep.title);
  if (existingByTitle) {
    // Update audio_url if now available
    if (ep.audio_url && !existingByTitle.audio_url) {
      db.prepare('UPDATE episodes SET audio_url = ? WHERE id = ?').run(ep.audio_url, existingByTitle.id);
    }
    return { id: existingByTitle.id, isNew: false };
  }
  const r = db.prepare(`
    INSERT INTO episodes (podcast_id, title, description, published_date, audio_url, episode_url, duration, guests)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(podcastId, ep.title, ep.description || '', ep.published_date || null,
    ep.audio_url || '', ep.episode_url || '', ep.duration || null, ep.guests || '');
  return { id: r.lastInsertRowid, isNew: true };
}

function hasTranscript(db, episodeId) {
  return !!db.prepare('SELECT id FROM transcripts WHERE episode_id = ?').get(episodeId);
}

function saveTranscript(db, episodeId, content, format, language, source) {
  db.prepare(`
    INSERT OR REPLACE INTO transcripts (episode_id, content, format, language, source)
    VALUES (?, ?, ?, ?, ?)
  `).run(episodeId, content, format, language || 'zh', source || 'crawl');
}

// ─── Phase 1: YouTube channel crawl ─────────────────────────────────────────
async function crawlYouTubeChannel(db, meta, stats, needsAsr) {
  const { channelId, language } = meta;
  const lang = language === 'zh' ? 'zh' : 'en';
  const fallbackLang = language === 'zh' ? 'zh-Hans' : 'en';

  console.log(`  📥 Fetching channel video list...`);
  const videos = getChannelVideos(channelId, 50);
  if (!videos.length) { console.log(`  ✗ No videos found`); return; }
  console.log(`  Found ${videos.length} videos`);

  const podcastId = upsertPodcast(db, meta);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podscribe-'));

  try {
    for (const video of videos) {
      if (!video.videoId) continue;
      const episodeUrl = `https://www.youtube.com/watch?v=${video.videoId}`;

      // Get metadata if title seems wrong
      let title = video.title;
      let epData = {
        title, description: '', episode_url: episodeUrl,
        audio_url: '', youtube_id: video.videoId,
        published_date: null, duration: null, guests: '',
      };

      const { id: episodeId, isNew } = upsertEpisode(db, podcastId, epData);
      if (isNew) stats.newEpisodes++;

      if (hasTranscript(db, episodeId)) {
        process.stdout.write('.');
        continue;
      }

      // Try caption download
      let caption = downloadCaption(video.videoId, lang, tmpDir);
      if (!caption && lang !== fallbackLang) {
        caption = downloadCaption(video.videoId, fallbackLang, tmpDir);
      }
      // Also try English as last resort for Chinese channels
      if (!caption && language === 'zh') {
        caption = downloadCaption(video.videoId, 'en', tmpDir);
      }

      if (caption) {
        saveTranscript(db, episodeId, caption.content, 'vtt', caption.language,
          caption.isAuto ? 'youtube_auto' : 'youtube_manual');
        stats.newTranscripts++;
        process.stdout.write('✓');
      } else {
        needsAsr.push({
          podcast: meta.name, host: meta.host, category: meta.category,
          episode: title, episode_url: episodeUrl, youtube_id: video.videoId,
          reason: 'YouTube: no captions available',
          action: 'Run Whisper ASR on audio; or use EchoShell while watching',
        });
        process.stdout.write('✗');
      }
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  }
  console.log('');
}

// ─── Phase 2: RSS feed crawl ─────────────────────────────────────────────────
async function crawlRssFeed(db, meta, stats, needsAsr) {
  if (!meta.rss) {
    // No RSS - add to platform needs
    return;
  }

  console.log(`  📡 RSS: ${meta.rss}`);
  const { ok, error, episodes } = await parseFeed(meta.rss, 100);
  if (!ok) { console.log(`  ✗ ${error}`); return; }
  console.log(`  Found ${episodes.length} episodes in RSS`);

  const podcastId = upsertPodcast(db, meta);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podscribe-rss-'));

  try {
    for (const ep of episodes) {
      const { id: episodeId, isNew } = upsertEpisode(db, podcastId, ep);
      if (isNew) stats.newEpisodes++;

      if (hasTranscript(db, episodeId)) { process.stdout.write('.'); continue; }

      // Check for inline podcast:transcript
      if (ep.transcript_url && (ep.transcript_type.includes('text') || ep.transcript_type.includes('srt') || ep.transcript_type.includes('vtt'))) {
        try {
          const r = await fetchUrl(ep.transcript_url);
          if (r.status === 200 && r.body.length > 200) {
            const fmt = ep.transcript_type.includes('vtt') ? 'vtt' :
                        ep.transcript_type.includes('srt') ? 'srt' : 'plain';
            saveTranscript(db, episodeId, r.body, fmt, meta.language, 'rss_transcript');
            stats.newTranscripts++;
            process.stdout.write('T');
            continue;
          }
        } catch {}
      }

      // Try YouTube if episode has a YouTube link
      if (ep.youtube_id) {
        const caption = downloadCaption(ep.youtube_id, meta.language === 'zh' ? 'zh' : 'en', tmpDir);
        if (caption) {
          saveTranscript(db, episodeId, caption.content, 'vtt', caption.language,
            caption.isAuto ? 'youtube_auto' : 'youtube_manual');
          stats.newTranscripts++;
          process.stdout.write('Y');
          continue;
        }
      }

      // No transcript - record for ASR
      needsAsr.push({
        podcast: meta.name, host: meta.host, category: meta.category,
        episode: ep.title, episode_url: ep.episode_url,
        audio_url: ep.audio_url, published_date: ep.published_date,
        youtube_id: ep.youtube_id || '',
        reason: ep.audio_url ? 'Audio only (RSS)' : 'No audio URL',
        action: ep.audio_url ? 'Run Whisper ASR: whisper audio.mp3 --language ' + (meta.language === 'zh' ? 'zh' : 'en') : 'Find audio source',
      });
      process.stdout.write('_');
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  }
  console.log('');
}

// ─── Report writer ────────────────────────────────────────────────────────────
function writeReport(stats, needsAsr) {
  const reportPath = path.join(__dirname, '../needs-asr.md');
  const now = new Date().toISOString().split('T')[0];
  const byPodcast = {};
  for (const item of needsAsr) {
    if (!item.episode) continue;
    if (!byPodcast[item.podcast]) byPodcast[item.podcast] = { host: item.host, category: item.category, items: [] };
    byPodcast[item.podcast].items.push(item);
  }

  let md = `# 播客文稿待处理报告
*生成时间: ${now} | 由 PodScribe 爬虫自动生成*

## 汇总统计

| 指标 | 数量 |
|------|------|
| 新增节目 | ${stats.newEpisodes} |
| 成功获取文字稿 | ${stats.newTranscripts} |
| 待 ASR 处理 | ${needsAsr.length} |

**图例**: ✓=成功下载字幕 ✗=无字幕需ASR T=RSS内嵌文字稿 Y=YouTube字幕 .=已有 _=无文字稿

---

## 一、已知无公开文字稿的平台

| 平台 | 说明 | 建议操作 |
|------|------|----------|
${MANUAL_PLATFORMS.map(p => `| **${p.name}** | ${p.desc} | ${p.action} |`).join('\n')}

---

## 二、各播客待处理节目

`;

  for (const [podcast, data] of Object.entries(byPodcast)) {
    const items = data.items;
    md += `### ${podcast} (${data.host}) — ${items.length} 集待处理\n\n`;
    md += `| 节目 | 发布日期 | 音频 | 原因 | 操作 |\n`;
    md += `|------|----------|------|------|------|\n`;
    for (const item of items.slice(0, 20)) {
      const title = item.episode?.slice(0, 45) || '(无标题)';
      const link = item.episode_url || item.audio_url || '';
      const titleCell = link ? `[${title}](${link})` : title;
      const audioLink = item.audio_url ? `[▶](${item.audio_url})` : '—';
      md += `| ${titleCell} | ${item.published_date || '—'} | ${audioLink} | ${item.reason} | ${item.action} |\n`;
    }
    if (items.length > 20) md += `\n*... 及另外 ${items.length - 20} 集*\n`;
    md += '\n';
  }

  md += `---

## 三、ASR 批量处理脚本

### Whisper (本地)
\`\`\`bash
# 中文播客
whisper audio.mp3 --language zh --model medium --output_format vtt --output_dir transcripts/

# 批量处理
for f in *.mp3 *.m4a; do
  whisper "$f" --language zh --model large-v3 --output_format vtt
done
\`\`\`

### Groq Whisper API (云端，速度最快)
\`\`\`bash
for f in *.mp3; do
  curl -X POST https://api.groq.com/openai/v1/audio/transcriptions \\
    -H "Authorization: Bearer $GROQ_API_KEY" \\
    -F "file=@$f" -F "model=whisper-large-v3" \\
    -F "language=zh" -F "response_format=vtt" > "\${f%.mp3}.vtt"
done
\`\`\`

### 上传到 PodScribe Forum
\`\`\`bash
# 上传单个节目
curl -X POST http://192.3.168.14:4010/api/upload \\
  -H "Content-Type: application/json" \\
  -d '{
    "podcast": {"name": "播客名", "category": "科技", "language": "zh"},
    "episode": {"title": "节目标题", "episode_url": "https://..."},
    "transcript": {"content": "...", "format": "vtt", "language": "zh", "source": "asr"}
  }'
\`\`\`
`;

  fs.writeFileSync(reportPath, md, 'utf8');
  console.log(`  📝 Report: needs-asr.md (${Object.keys(byPodcast).length} podcasts, ${needsAsr.length} episodes)`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const db = getDb();
  const stats = { newEpisodes: 0, newTranscripts: 0 };
  const needsAsr = [];

  console.log('🎙️  PodScribe Mega Crawler\n');
  console.log('Legend: ✓=caption downloaded  ✗=no caption  T=inline transcript  Y=YouTube caption  .=skip  _=needs ASR\n');

  // Phase 1: YouTube channels
  console.log('═══════════════════════════════════════════════════════');
  console.log(' Phase 1: YouTube Channels');
  console.log('═══════════════════════════════════════════════════════\n');

  for (const channel of YOUTUBE_CHANNELS) {
    console.log(`\n📺 ${channel.name} (${channel.host}) [@${channel.channelId}]`);
    try {
      await crawlYouTubeChannel(db, channel, stats, needsAsr);
    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // Phase 2: RSS feeds
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' Phase 2: RSS Feeds');
  console.log('═══════════════════════════════════════════════════════\n');

  for (const podcast of RSS_PODCASTS) {
    console.log(`\n📻 ${podcast.name} (${podcast.host})`);
    try {
      await crawlRssFeed(db, podcast, stats, needsAsr);
    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // Write report
  console.log('\n═══════════════════════════════════════════════════════');
  writeReport(stats, needsAsr);

  // Final DB stats
  const dbStats = {
    podcasts: db.prepare('SELECT count(*) as c FROM podcasts').get().c,
    episodes: db.prepare('SELECT count(*) as c FROM episodes').get().c,
    transcripts: db.prepare('SELECT count(*) as c FROM transcripts').get().c,
  };

  console.log(`
╔═══════════════════════════════════════╗
║  PodScribe Crawler — Final Results    ║
╠═══════════════════════════════════════╣
║  DB Total Podcasts:   ${String(dbStats.podcasts).padEnd(15)} ║
║  DB Total Episodes:   ${String(dbStats.episodes).padEnd(15)} ║
║  DB Total Transcripts:${String(dbStats.transcripts).padEnd(15)} ║
╠═══════════════════════════════════════╣
║  This Run:                            ║
║    New episodes:      ${String(stats.newEpisodes).padEnd(15)} ║
║    New transcripts:   ${String(stats.newTranscripts).padEnd(15)} ║
║    Needs ASR/OCR:     ${String(needsAsr.length).padEnd(15)} ║
╚═══════════════════════════════════════╝`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
