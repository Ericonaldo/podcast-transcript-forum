#!/usr/bin/env node
// Seed script to populate demo data
require('dotenv').config();
const { getDb, closeDb } = require('../server/src/db');

const db = getDb();

const podcasts = [
  {
    name: '硅谷101',
    host: 'Yi Pan',
    description: '用通俗的语言讲述硅谷科技公司、创始人及其背后的故事。',
    category: '科技',
    image_url: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts116/v4/3f/6d/fc/3f6dfc36-ae6d-d3fc-6726-e0acb7fbbc72/mza_14498024898547640764.jpg/600x600bb.jpg',
    website_url: 'https://sv101.fireside.fm',
    language: 'zh'
  },
  {
    name: '商业就是这样',
    host: '吴晓波',
    description: '吴晓波频道出品，探讨商业世界的规律与逻辑。',
    category: '商业',
    website_url: 'https://www.ximalaya.com/album/6362913',
    language: 'zh'
  },
  {
    name: '得到头条',
    host: '罗振宇',
    description: '每天5分钟，了解当天最值得关注的新鲜知识。',
    category: '教育',
    website_url: 'https://www.dedao.cn',
    language: 'zh'
  },
  {
    name: '创业内幕',
    host: '王思远',
    description: '深度访谈中国最顶尖的创业者，还原真实的创业故事。',
    category: '商业',
    language: 'zh'
  },
  {
    name: '跨越边界',
    host: 'Mia',
    description: '聚焦全球视野，探讨文化、科技、生活的交汇点。',
    category: '文化',
    language: 'zh'
  },
  {
    name: '科技早知道',
    host: 'Signal',
    description: '解读全球科技前沿动态，关注AI、芯片、互联网等领域。',
    category: '科技',
    language: 'zh'
  }
];

const episodes = [
  {
    podcast_name: '硅谷101',
    episodes: [
      {
        title: 'OpenAI的成长与危机：从非营利到商业帝国',
        description: '深度解析OpenAI的发展历程，从2015年创立到ChatGPT的爆红，以及内部的权力博弈。',
        published_date: '2024-01-15',
        duration: 3720,
        episode_number: 82,
        guests: 'Sam Altman (via reports)',
        episode_url: 'https://sv101.fireside.fm/82',
      },
      {
        title: 'Anthropic：从OpenAI叛逃者到AI安全先锋',
        description: '探讨Anthropic的创立故事，以及Claude AI背后的Constitutional AI理念。',
        published_date: '2024-02-20',
        duration: 4200,
        episode_number: 85,
        guests: 'Dario Amodei, Daniela Amodei (background)',
        episode_url: 'https://sv101.fireside.fm/85',
      }
    ]
  },
  {
    podcast_name: '科技早知道',
    episodes: [
      {
        title: 'AI Agent时代到来：2024年的智能体浪潮',
        description: '深入分析AI Agent的技术原理和商业应用，以及对各行业的深远影响。',
        published_date: '2024-03-10',
        duration: 2700,
        episode_number: 156,
      }
    ]
  },
  {
    podcast_name: '创业内幕',
    episodes: [
      {
        title: '雷军：从程序员到汽车人的40年',
        description: '专访小米创始人雷军，聊他的创业哲学、造车决策和人生感悟。',
        published_date: '2024-02-01',
        duration: 5400,
        episode_number: 45,
        guests: '雷军',
      }
    ]
  }
];

console.log('Seeding database...');

// Insert podcasts
const podcastMap = {};
for (const p of podcasts) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO podcasts (name, host, description, category, image_url, website_url, language)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(p.name, p.host, p.description, p.category, p.image_url || null, p.website_url || null, p.language);

  const podcast = db.prepare('SELECT id FROM podcasts WHERE name = ?').get(p.name);
  podcastMap[p.name] = podcast.id;
  console.log(`  ✓ Podcast: ${p.name} (id: ${podcast.id})`);
}

// Insert episodes and transcripts
for (const group of episodes) {
  const podcastId = podcastMap[group.podcast_name];
  if (!podcastId) continue;

  for (const ep of group.episodes) {
    // Check if episode already exists
    const existing = db.prepare('SELECT id FROM episodes WHERE podcast_id = ? AND title = ?').get(podcastId, ep.title);
    let episodeId;

    if (existing) {
      episodeId = existing.id;
    } else {
      const result = db.prepare(`
        INSERT INTO episodes (podcast_id, title, description, published_date, duration, episode_number, guests)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(podcastId, ep.title, ep.description || null, ep.published_date || null, ep.duration || null, ep.episode_number || null, ep.guests || null);
      episodeId = result.lastInsertRowid;
    }

    if (ep.transcript) {
      const existingTr = db.prepare('SELECT id FROM transcripts WHERE episode_id = ?').get(episodeId);
      if (!existingTr) {
        db.prepare(`
          INSERT INTO transcripts (episode_id, content, format, language, source)
          VALUES (?, ?, 'plain', 'zh', 'manual')
        `).run(episodeId, ep.transcript.trim());
      }
    }

    console.log(`  ✓ Episode: ${ep.title}`);
  }
}

closeDb();
console.log('\n✅ Seed complete!');
