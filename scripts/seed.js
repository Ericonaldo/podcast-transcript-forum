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
        transcript: `欢迎收听硅谷101。今天我们来聊一聊OpenAI这家公司的成长历程与危机。

2015年，Elon Musk、Sam Altman等人共同创立了OpenAI，最初的使命是确保人工智能的安全发展，造福全人类。作为一家非营利组织，它的创立理念非常崇高。

然而，随着深度学习技术的发展，训练顶尖AI模型需要越来越多的计算资源和资金。2019年，OpenAI进行了重大转型，建立了"有限盈利"结构，引入了微软等投资方。

2022年底，ChatGPT的发布彻底改变了AI行业格局。这款产品在发布后仅5天就吸引了100万用户，在两个月内突破了1亿用户，成为历史上增长最快的消费级应用。

但就在ChatGPT火爆全球的背后，OpenAI内部也发生了一场震动科技界的权力危机。2023年11月，董事会突然宣布解雇CEO Sam Altman，随后经历了戏剧性的复职过程。

这场危机背后，是AI安全理念与商业化发展之间的深层矛盾。董事会代表的是OpenAI最初的使命——确保AI安全，而Sam Altman代表的是快速商业化的路径。

最终的结果我们都知道了，Sam Altman回归，OpenAI继续其商业化征程。这场危机让我们看到了在通用人工智能时代，使命与商业之间的必然张力。`,
      },
      {
        title: 'Anthropic：从OpenAI叛逃者到AI安全先锋',
        description: '探讨Anthropic的创立故事，以及Claude AI背后的Constitutional AI理念。',
        published_date: '2024-02-20',
        duration: 4200,
        episode_number: 85,
        guests: 'Dario Amodei, Daniela Amodei (background)',
        transcript: `今天我们来聊Anthropic这家公司。

Anthropic由前OpenAI高管Dario Amodei和Daniela Amodei兄妹，以及其他从OpenAI出走的研究员共同创立于2021年。

他们离开OpenAI的原因，据报道是对公司过于激进的商业化路线感到担忧，希望建立一家更加注重AI安全的公司。

Anthropic的核心技术理念是"Constitutional AI"——通过给AI制定一套"宪法"原则，让AI自我学习如何符合人类价值观，而不是单纯依靠人类反馈训练。

他们的旗舰产品Claude系列，以安全性和诚实性著称。在用户测试中，Claude往往比ChatGPT更加谨慎，不太容易被"越狱"。

2023年，亚马逊宣布向Anthropic投资高达40亿美元，谷歌也跟进了投资。这让Anthropic的估值迅速攀升到180亿美元。

有趣的是，Anthropic虽然以"安全"为旗帜，但也在快速商业化。这也许说明，在AI浪潮中，纯粹的理想主义很难持久，商业化是所有AI公司的必经之路。`,
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
        transcript: `各位听众大家好，欢迎收听科技早知道。

2024年，AI Agent成为了科技圈最热门的话题之一。究竟什么是AI Agent？为什么它如此重要？

AI Agent，即人工智能代理，是一种能够自主执行任务、做出决策的AI系统。与传统的AI对话模型不同，Agent不仅能够回答问题，还能主动采取行动——比如浏览网页、执行代码、调用API等。

可以把Agent想象成一个拥有工具箱的助手。你给它一个目标，它能够自主规划步骤、使用各种工具，最终完成任务。这与之前AI只能"说"不能"做"有了根本性的区别。

目前主流的Agent框架包括：LangChain、AutoGPT、ReAct等。这些框架让开发者能够快速构建具有复杂推理能力的AI应用。

在商业应用方面，Agent正在改变客服、销售、编程等多个领域。例如，GitHub Copilot已经从代码补全进化成了能够自主完成编程任务的Agent。

然而，Agent也带来了新的风险。当AI能够自主行动时，如何确保它的行为符合人类意图？如何防止出现意外后果？这些都是当前AI安全研究的重要课题。`
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
        transcript: `今天非常荣幸邀请到了小米集团创始人、董事长兼CEO雷军先生。

雷军，1969年出生于湖北，武汉大学计算机系毕业。他的创业故事从上世纪90年代就开始了，从最早的软件公司，到金山软件，再到后来天使投资，最终在2010年创立小米。

雷军：我觉得创业最重要的是选赛道。我创立小米的时候，智能手机刚刚开始普及，我看到了一个巨大的机会——用互联网思维做手机。

2021年，我宣布小米进军汽车行业。很多人问我，为什么都55岁了还要再创业？

这是我人生最后一次重大创业项目，我愿意押上我所有积累的战绩和声誉，为小米汽车而战。

做汽车比做手机难多了。汽车涉及到几万个零部件，安全标准极高，供应链极其复杂。我们为此投入了大量资源，聘请了最顶尖的工程师团队。

SU7发布后，我们获得了超出预期的市场反应。第一天就有10万个大定。这让我们既高兴又有压力，我们必须快速提升产能，不辜负用户的信任。

对于年轻的创业者，我的建议是：要勇于尝试，但也要理性评估风险。创业是一场马拉松，不是百米冲刺。`
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
