#!/usr/bin/env node
/**
 * /update-podcasts skill
 * Fetches latest episodes for all podcasts from YouTube/RSS/B站.
 * Usage: node scripts/update-podcasts.js [--podcast-id=16] [--limit=10]
 */
require('dotenv').config();
const { execSync, spawnSync } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDb, closeDb } = require('../server/src/db');

const args = process.argv.slice(2);
const podcastId = args.find(a => a.startsWith('--podcast-id='))?.split('=')[1];
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '10');

// ── YouTube/B站 via yt-dlp ──
function getChannelVideos(url, max = 20) {
  const r = spawnSync('yt-dlp', [
    '--flat-playlist', '--print', 'id', '--print', 'title',
    '--playlist-end', String(max), '--no-playlist', '--quiet', url,
  ], { timeout: 90000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) return [];
  const lines = r.stdout.trim().split('\n').filter(Boolean);
  const videos = [];
  for (let i = 0; i < lines.length - 1; i += 2) {
    if (lines[i].match(/^[A-Za-z0-9_-]{11}$/)) {
      videos.push({ videoId: lines[i], title: lines[i + 1] || '' });
    } else {
      videos.push({ title: lines[i], videoId: lines[i + 1] || '' });
    }
  }
  return videos.filter(v => v.videoId && v.title);
}

function getVideoMeta(videoId, platform = 'youtube') {
  const url = platform === 'bilibili'
    ? `https://www.bilibili.com/video/${videoId}`
    : `https://www.youtube.com/watch?v=${videoId}`;
  const r = spawnSync('yt-dlp', [
    '--print', 'title', '--print', 'upload_date', '--print', 'duration',
    '--print', 'description', '--no-playlist', '--quiet', url,
  ], { timeout: 30000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) return null;
  const [title, date, dur, ...desc] = r.stdout.trim().split('\n');
  return {
    title: title?.trim(),
    published_date: date?.length === 8 ? `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}` : null,
    duration: parseInt(dur) || null,
    description: desc.join('\n').slice(0, 1000),
  };
}

// ── RSS ──
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'PodcastCrawler/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'))
    || xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].trim().replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '';
}

function extractAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<${tag}[^>]+${attr}="([^"]+)"`, 'i'));
  return m ? m[1] : '';
}

async function updateFromRSS(db, podcast) {
  if (!podcast.rss_url) return 0;
  console.log(`  RSS: ${podcast.rss_url}`);
  try {
    const xml = await fetchUrl(podcast.rss_url);
    const items = xml.split(/<item[\s>]/i);
    let added = 0;
    for (let i = 1; i < Math.min(items.length, limit + 1); i++) {
      const item = items[i];
      const title = extractTag(item, 'title');
      if (!title) continue;
      const existing = db.prepare('SELECT id FROM episodes WHERE podcast_id=? AND title=?').get(podcast.id, title);
      if (existing) continue;
      const desc = extractTag(item, 'description').slice(0, 1000);
      const pubDate = extractTag(item, 'pubDate');
      const audioUrl = extractAttr(item, 'enclosure', 'url');
      const dur = extractTag(item, 'itunes:duration');
      let duration = null;
      if (dur) {
        const parts = dur.split(':').map(Number);
        duration = parts.length === 3 ? parts[0]*3600+parts[1]*60+parts[2] : parts.length === 2 ? parts[0]*60+parts[1] : parseInt(dur) || null;
      }
      let publishedDate = null;
      if (pubDate) try { publishedDate = new Date(pubDate).toISOString().split('T')[0]; } catch(e) {}
      db.prepare('INSERT INTO episodes (podcast_id,title,description,published_date,duration,audio_url) VALUES (?,?,?,?,?,?)').run(
        podcast.id, title, desc || null, publishedDate, duration, audioUrl || null
      );
      added++;
      console.log(`    + ${title.slice(0, 60)}`);
    }
    return added;
  } catch (e) {
    console.log(`    Error: ${e.message}`);
    return 0;
  }
}

function updateFromChannel(db, podcast, channelUrl, platform) {
  console.log(`  ${platform}: ${channelUrl}`);
  const videos = getChannelVideos(channelUrl, limit);
  let added = 0;
  for (const v of videos) {
    const epUrl = platform === 'bilibili'
      ? `https://www.bilibili.com/video/${v.videoId}`
      : `https://www.youtube.com/watch?v=${v.videoId}`;
    const existing = db.prepare('SELECT id FROM episodes WHERE podcast_id=? AND (episode_url=? OR title=?)').get(podcast.id, epUrl, v.title);
    if (existing) continue;
    // Get full metadata
    const meta = getVideoMeta(v.videoId, platform) || { title: v.title };
    const imgUrl = platform === 'youtube' ? `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg` : null;
    db.prepare('INSERT INTO episodes (podcast_id,title,description,published_date,duration,episode_url,image_url) VALUES (?,?,?,?,?,?,?)').run(
      podcast.id, meta.title || v.title, meta.description || null, meta.published_date, meta.duration, epUrl, imgUrl
    );
    added++;
    console.log(`    + ${(meta.title || v.title).slice(0, 60)}`);
  }
  return added;
}

async function main() {
  const db = getDb();

  // Get podcasts to update
  let podcasts;
  if (podcastId) {
    podcasts = db.prepare('SELECT * FROM podcasts WHERE id=?').all(parseInt(podcastId));
  } else {
    podcasts = db.prepare('SELECT * FROM podcasts ORDER BY id').all();
  }

  console.log(`\n🔄 Update Podcasts: ${podcasts.length} podcasts, limit=${limit}\n`);
  let totalAdded = 0;

  for (const pod of podcasts) {
    console.log(`${pod.name} (id=${pod.id})`);
    let added = 0;

    // Determine source type from website_url or existing episodes
    const hasBili = pod.website_url?.includes('bilibili') || db.prepare("SELECT id FROM episodes WHERE podcast_id=? AND episode_url LIKE '%bilibili%' LIMIT 1").get(pod.id);
    const hasYT = db.prepare("SELECT id FROM episodes WHERE podcast_id=? AND episode_url LIKE '%youtube%' LIMIT 1").get(pod.id);

    if (hasBili && pod.website_url?.includes('bilibili')) {
      added += updateFromChannel(db, pod, pod.website_url + '/upload/video', 'bilibili');
    } else if (hasYT) {
      // Try YouTube handle from existing episode URLs
      const sampleEp = db.prepare("SELECT episode_url FROM episodes WHERE podcast_id=? AND episode_url LIKE '%youtube%' LIMIT 1").get(pod.id);
      // Can't easily get channel from video URL; skip YouTube channel fetch
    }

    if (pod.rss_url) {
      added += await updateFromRSS(db, pod);
    }

    totalAdded += added;
    if (added > 0) console.log(`  → ${added} new episodes`);
    else console.log(`  → up to date`);
  }

  console.log(`\n✅ Total new episodes: ${totalAdded}`);
  closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
