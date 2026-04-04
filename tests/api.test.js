const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Use a temp DB for tests
const TEST_DB = path.join(__dirname, '../data/test.db');
process.env.DB_PATH = TEST_DB;
process.env.DATA_DIR = path.join(__dirname, '../data');

// Clean up before tests
beforeAll(() => {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

afterAll(() => {
  const { closeDb } = require('../server/src/db');
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

const app = require('../server/src/index');

describe('Health Check', () => {
  test('GET /api/health returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Podcasts API', () => {
  let podcastId;

  test('GET /api/podcasts returns empty list', async () => {
    const res = await request(app).get('/api/podcasts');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  test('POST /api/podcasts creates a podcast', async () => {
    const res = await request(app).post('/api/podcasts').send({
      name: '硅谷101',
      host: 'Yi Pan',
      description: '探索科技与创新的播客',
      category: '科技',
      website_url: 'https://sv101.fireside.fm',
      language: 'zh'
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('硅谷101');
    expect(res.body.host).toBe('Yi Pan');
    expect(res.body.category).toBe('科技');
    podcastId = res.body.id;
  });

  test('POST /api/podcasts requires name', async () => {
    const res = await request(app).post('/api/podcasts').send({ host: 'test' });
    expect(res.status).toBe(400);
  });

  test('GET /api/podcasts returns created podcast', async () => {
    const res = await request(app).get('/api/podcasts');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].name).toBe('硅谷101');
  });

  test('GET /api/podcasts/:id returns podcast', async () => {
    const res = await request(app).get(`/api/podcasts/${podcastId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(podcastId);
    expect(res.body.episode_count).toBe(0);
  });

  test('GET /api/podcasts/:id returns 404 for missing', async () => {
    const res = await request(app).get('/api/podcasts/99999');
    expect(res.status).toBe(404);
  });

  test('PUT /api/podcasts/:id updates podcast', async () => {
    const res = await request(app).put(`/api/podcasts/${podcastId}`).send({
      name: '硅谷101 Updated',
      host: 'Yi Pan',
      category: '科技'
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('硅谷101 Updated');
  });

  test('GET /api/podcasts/categories returns categories', async () => {
    const res = await request(app).get('/api/podcasts/categories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some(c => c.category === '科技')).toBe(true);
  });

  test('GET /api/podcasts with category filter', async () => {
    // Add another podcast with different category
    await request(app).post('/api/podcasts').send({ name: '商业播客', category: '商业', host: 'Someone' });

    const res = await request(app).get('/api/podcasts?category=科技');
    expect(res.status).toBe(200);
    expect(res.body.data.every(p => p.category === '科技')).toBe(true);
  });

  test('DELETE /api/podcasts/:id deletes podcast', async () => {
    const create = await request(app).post('/api/podcasts').send({ name: 'Delete Me' });
    const delRes = await request(app).delete(`/api/podcasts/${create.body.id}`);
    expect(delRes.status).toBe(200);
    const get = await request(app).get(`/api/podcasts/${create.body.id}`);
    expect(get.status).toBe(404);
  });

  // Export podcastId for other tests
  global.testPodcastId = podcastId;
});

describe('Episodes API', () => {
  let podcastId, episodeId;

  beforeAll(async () => {
    const res = await request(app).post('/api/podcasts').send({
      name: 'Test Podcast for Episodes',
      host: 'Test Host',
      category: '教育'
    });
    podcastId = res.body.id;
  });

  test('POST /api/episodes creates episode', async () => {
    const res = await request(app).post('/api/episodes').send({
      podcast_id: podcastId,
      title: 'Episode 1: Getting Started',
      description: 'The first episode',
      published_date: '2024-01-01',
      duration: 3600,
      audio_url: 'https://example.com/ep1.mp3',
      episode_url: 'https://example.com/episodes/1',
      episode_number: 1,
      guests: 'Alice, Bob'
    });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Episode 1: Getting Started');
    expect(res.body.episode_number).toBe(1);
    episodeId = res.body.id;
  });

  test('POST /api/episodes requires podcast_id and title', async () => {
    const res = await request(app).post('/api/episodes').send({ title: 'No podcast' });
    expect(res.status).toBe(400);
  });

  test('POST /api/episodes returns 404 for non-existent podcast', async () => {
    const res = await request(app).post('/api/episodes').send({
      podcast_id: 99999,
      title: 'Test'
    });
    expect(res.status).toBe(404);
  });

  test('GET /api/episodes/:id returns episode', async () => {
    const res = await request(app).get(`/api/episodes/${episodeId}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Episode 1: Getting Started');
    expect(res.body.podcast_name).toBe('Test Podcast for Episodes');
  });

  test('GET /api/episodes/:id returns 404 for missing', async () => {
    const res = await request(app).get('/api/episodes/99999');
    expect(res.status).toBe(404);
  });

  test('GET /api/podcasts/:id/episodes returns episode list', async () => {
    const res = await request(app).get(`/api/podcasts/${podcastId}/episodes`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.pagination.total).toBeGreaterThan(0);
  });

  test('GET /api/podcasts/:id/episodes falls back to podcast cover image when episode image is missing', async () => {
    const coverPodcast = await request(app).post('/api/podcasts').send({
      name: 'Cover Fallback Podcast',
      host: 'Cover Host',
      image_url: 'https://example.com/podcast-cover.jpg',
    });

    const createdEpisode = await request(app).post('/api/episodes').send({
      podcast_id: coverPodcast.body.id,
      title: 'Episode Without Image',
      episode_url: 'https://example.com/episode-without-image',
    });

    expect(createdEpisode.status).toBe(201);

    const res = await request(app).get(`/api/podcasts/${coverPodcast.body.id}/episodes`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].image_url).toBe('https://example.com/podcast-cover.jpg');
  });

  test('PUT /api/episodes/:id updates episode', async () => {
    const res = await request(app).put(`/api/episodes/${episodeId}`).send({
      title: 'Episode 1 Updated',
      duration: 4000
    });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Episode 1 Updated');
    expect(res.body.duration).toBe(4000);
  });

  test('DELETE /api/episodes/:id deletes episode', async () => {
    const ep = await request(app).post('/api/episodes').send({
      podcast_id: podcastId,
      title: 'Delete Me Episode'
    });
    const delRes = await request(app).delete(`/api/episodes/${ep.body.id}`);
    expect(delRes.status).toBe(200);
    const get = await request(app).get(`/api/episodes/${ep.body.id}`);
    expect(get.status).toBe(404);
  });

  // Keep for transcript tests
  global.testEpisodeId = episodeId;
  global.testPodcastIdForEp = podcastId;
});

describe('Transcripts API', () => {
  let podcastId, episodeId;

  beforeAll(async () => {
    const podcast = await request(app).post('/api/podcasts').send({
      name: 'Transcript Test Podcast',
      category: '科技'
    });
    podcastId = podcast.body.id;

    const episode = await request(app).post('/api/episodes').send({
      podcast_id: podcastId,
      title: 'Episode with Transcript'
    });
    episodeId = episode.body.id;
  });

  test('GET /api/episodes/:id/transcript returns 404 when no transcript', async () => {
    const res = await request(app).get(`/api/episodes/${episodeId}/transcript`);
    expect(res.status).toBe(404);
  });

  test('POST /api/episodes/:id/transcript creates transcript', async () => {
    const content = `欢迎收听本期节目。今天我们将讨论人工智能的发展趋势。

人工智能正在深刻改变我们的生活方式。从语音助手到自动驾驶，AI技术已经渗透到各个领域。

在这一期节目中，我们将深入探讨大型语言模型的工作原理，以及它们在未来将如何影响社会。`;

    const res = await request(app).post(`/api/episodes/${episodeId}/transcript`).send({
      content,
      format: 'plain',
      language: 'zh',
      source: 'manual'
    });
    expect(res.status).toBe(201);
    expect(res.body.content).toBe(content);
    expect(res.body.episode_id).toBe(episodeId);
  });

  test('GET /api/episodes/:id/transcript returns transcript', async () => {
    const res = await request(app).get(`/api/episodes/${episodeId}/transcript`);
    expect(res.status).toBe(200);
    expect(res.body.content).toContain('人工智能');
    expect(res.body.format).toBe('plain');
  });

  test('POST /api/episodes/:id/transcript replaces existing transcript (same language)', async () => {
    const res = await request(app).post(`/api/episodes/${episodeId}/transcript`).send({
      content: 'Updated transcript content',
      format: 'plain'
    });
    // 200 when updating existing same-language transcript
    expect([200, 201]).toContain(res.status);
    const get = await request(app).get(`/api/episodes/${episodeId}/transcript`);
    expect(get.body.content).toBe('Updated transcript content');
  });

  test('POST /api/episodes/:id/transcript adds second language', async () => {
    const res = await request(app).post(`/api/episodes/${episodeId}/transcript`).send({
      content: 'English transcript content',
      format: 'plain',
      language: 'en'
    });
    expect(res.status).toBe(201);
    // Should be two languages now
    const get = await request(app).get(`/api/episodes/${episodeId}/transcript`);
    expect(get.body.available_languages).toBeDefined();
    expect(get.body.available_languages.length).toBeGreaterThanOrEqual(2);
    // Request specific language
    const en = await request(app).get(`/api/episodes/${episodeId}/transcript?lang=en`);
    expect(en.body.content).toBe('English transcript content');
    expect(en.body.language).toBe('en');
  });

  test('POST /api/episodes/:id/transcript requires content', async () => {
    const res = await request(app).post(`/api/episodes/${episodeId}/transcript`).send({});
    expect(res.status).toBe(400);
  });
});

describe('Search API', () => {
  beforeAll(async () => {
    // Seed search test data
    const podcast = await request(app).post('/api/podcasts').send({
      name: '创业内幕',
      host: '张伟',
      description: '创业者的故事',
      category: '商业'
    });
    const ep = await request(app).post('/api/episodes').send({
      podcast_id: podcast.body.id,
      title: 'Elon Musk 的创业哲学',
      description: '探讨马斯克的商业决策',
      guests: 'Elon Musk'
    });
    await request(app).post(`/api/episodes/${ep.body.id}/transcript`).send({
      content: '今天我们邀请到了硅谷著名创业者，讨论SpaceX和Tesla的发展历程。人工智能将改变所有行业。',
      format: 'plain'
    });
  });

  test('GET /api/search requires query', async () => {
    const res = await request(app).get('/api/search');
    expect(res.status).toBe(400);
  });

  test('GET /api/search?q=创业 returns results', async () => {
    const res = await request(app).get('/api/search?q=创业');
    expect(res.status).toBe(200);
    expect(res.body.results).toBeDefined();
    expect(res.body.query).toBe('创业');
  });

  test('GET /api/search?q=Elon&type=episode returns episode results', async () => {
    const res = await request(app).get('/api/search?q=Elon&type=episode');
    expect(res.status).toBe(200);
    expect(res.body.results.episodes.length).toBeGreaterThan(0);
    // When type=episode, only episodes should be in results
    expect(res.body.results.podcasts).toBeUndefined();
    expect(res.body.results.transcripts).toBeUndefined();
  });

  test('GET /api/search?q=SpaceX&type=transcript returns transcript results', async () => {
    const res = await request(app).get('/api/search?q=SpaceX&type=transcript');
    expect(res.status).toBe(200);
    // SpaceX is in the transcript we seeded
    expect(Array.isArray(res.body.results.transcripts)).toBe(true);
  });

  test('GET /api/search with empty query returns 400', async () => {
    const res = await request(app).get('/api/search?q=');
    expect(res.status).toBe(400);
  });

  test('GET /api/search with type=podcast filters correctly', async () => {
    const res = await request(app).get('/api/search?q=创业&type=podcast');
    expect(res.status).toBe(200);
    expect(res.body.results.podcasts).toBeDefined();
    expect(res.body.results.episodes).toBeUndefined();
    expect(res.body.results.transcripts).toBeUndefined();
  });

  test('GET /api/search pagination', async () => {
    const res = await request(app).get('/api/search?q=创业&page=1&limit=5');
    expect(res.status).toBe(200);
    expect(res.body.pagination).toBeDefined();
  });
});

describe('Data integrity', () => {
  test('Deleting podcast cascades to episodes', async () => {
    const podcast = await request(app).post('/api/podcasts').send({ name: 'Cascade Test' });
    const episode = await request(app).post('/api/episodes').send({
      podcast_id: podcast.body.id,
      title: 'Cascade Episode'
    });
    await request(app).post(`/api/episodes/${episode.body.id}/transcript`).send({ content: 'Test' });

    await request(app).delete(`/api/podcasts/${podcast.body.id}`);

    const epRes = await request(app).get(`/api/episodes/${episode.body.id}`);
    expect(epRes.status).toBe(404);
  });

  test('Episode count on podcast is accurate', async () => {
    const podcast = await request(app).post('/api/podcasts').send({ name: 'Count Test Podcast' });
    const pid = podcast.body.id;

    await request(app).post('/api/episodes').send({ podcast_id: pid, title: 'Ep 1' });
    await request(app).post('/api/episodes').send({ podcast_id: pid, title: 'Ep 2' });
    await request(app).post('/api/episodes').send({ podcast_id: pid, title: 'Ep 3' });

    const res = await request(app).get(`/api/podcasts/${pid}`);
    expect(res.body.episode_count).toBe(3);
  });

  test('Transcript count on podcast reflects episodes', async () => {
    const podcast = await request(app).post('/api/podcasts').send({ name: 'Transcript Count Podcast' });
    const pid = podcast.body.id;

    const ep1 = await request(app).post('/api/episodes').send({ podcast_id: pid, title: 'Ep A' });
    const ep2 = await request(app).post('/api/episodes').send({ podcast_id: pid, title: 'Ep B' });

    await request(app).post(`/api/episodes/${ep1.body.id}/transcript`).send({ content: 'Transcript A' });

    const res = await request(app).get(`/api/podcasts/${pid}`);
    expect(res.body.transcript_count).toBe(1);
  });
});

describe('Upload API (anonymous)', () => {
  const EPISODE_URL = 'https://youtube.com/watch?v=test123';

  test('POST /api/upload creates podcast + episode + transcript', async () => {
    const res = await request(app).post('/api/upload').send({
      podcast: { name: 'EchoShell Test Podcast', host: 'Test Host', category: '科技', language: 'zh' },
      episode: { title: 'Test Episode via Upload', episode_url: EPISODE_URL },
      transcript: { content: '这是通过插件上传的转译文字稿。', language: 'zh', source: 'asr' }
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.episodeId).toBeDefined();
    expect(res.body.podcastId).toBeDefined();
    expect(res.body.transcriptId).toBeDefined();
  });

  test('GET /api/check?url= finds uploaded transcript', async () => {
    const res = await request(app).get(`/api/check?url=${encodeURIComponent(EPISODE_URL)}`);
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.episodeId).toBeDefined();
    expect(res.body.podcastName).toBe('EchoShell Test Podcast');
    expect(res.body.episodeTitle).toBe('Test Episode via Upload');
  });

  test('GET /api/check?url= returns not found for unknown URL', async () => {
    const res = await request(app).get('/api/check?url=https://unknown.example.com/episode');
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
  });

  test('GET /api/check requires url param', async () => {
    const res = await request(app).get('/api/check');
    expect(res.status).toBe(400);
  });

  test('POST /api/upload requires podcast.name', async () => {
    const res = await request(app).post('/api/upload').send({
      episode: { title: 'No podcast name' },
      transcript: { content: 'Some text' }
    });
    expect(res.status).toBe(400);
  });

  test('POST /api/upload requires episode.title', async () => {
    const res = await request(app).post('/api/upload').send({
      podcast: { name: 'Valid Podcast' },
      transcript: { content: 'Some text' }
    });
    expect(res.status).toBe(400);
  });

  test('POST /api/upload requires transcript.content', async () => {
    const res = await request(app).post('/api/upload').send({
      podcast: { name: 'Valid Podcast' },
      episode: { title: 'Valid Episode' }
    });
    expect(res.status).toBe(400);
  });

  test('POST /api/upload finds existing podcast by name (case-insensitive)', async () => {
    // Upload with same podcast name (different case)
    const res = await request(app).post('/api/upload').send({
      podcast: { name: 'echoshell test podcast' }, // lowercase
      episode: { title: 'Another Episode', episode_url: 'https://youtube.com/watch?v=other456' },
      transcript: { content: 'Another transcript.' }
    });
    expect(res.status).toBe(201);
    // Should reuse same podcast (check via GET)
    const pod = await request(app).get(`/api/podcasts/${res.body.podcastId}`);
    expect(pod.body.episode_count).toBe(2);
  });

  test('POST /api/upload replaces transcript if episode URL already exists', async () => {
    // Re-upload the same episode URL
    const res = await request(app).post('/api/upload').send({
      podcast: { name: 'EchoShell Test Podcast' },
      episode: { title: 'Test Episode via Upload', episode_url: EPISODE_URL },
      transcript: { content: '更新后的转译文字稿。', source: 'asr' }
    });
    expect(res.status).toBe(201);
    // Verify the transcript was updated
    const transcriptRes = await request(app).get(`/api/episodes/${res.body.episodeId}/transcript`);
    expect(transcriptRes.body.content).toBe('更新后的转译文字稿。');
  });
});

describe('Revisions API', () => {
  let episodeId;
  let revSha;

  beforeAll(async () => {
    // Create a podcast + episode + transcript via upload
    const res = await request(app).post('/api/upload').send({
      podcast: { name: 'Revisions Test Podcast' },
      episode: { title: 'Revisions Test Episode', episode_url: 'https://example.com/rev-episode' },
      transcript: { content: '第一版内容。', source: 'manual' }
    });
    expect(res.status).toBe(201);
    episodeId = res.body.episodeId;
  });

  test('GET /api/episodes/:id/revisions returns list with initial revision', async () => {
    const res = await request(app).get(`/api/episodes/${episodeId}/revisions`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const first = res.body[0];
    expect(first).toHaveProperty('sha');
    expect(first).toHaveProperty('message');
    expect(first).toHaveProperty('author');
    expect(first).toHaveProperty('source');
    expect(first).toHaveProperty('created_at');
    revSha = first.sha;
  });

  test('GET /api/episodes/:id/revisions/:sha returns full revision with content', async () => {
    const res = await request(app).get(`/api/episodes/${episodeId}/revisions/${revSha}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sha', revSha);
    expect(res.body).toHaveProperty('content');
    expect(typeof res.body.content).toBe('string');
  });

  test('POST /api/episodes/:id/revisions creates a new revision', async () => {
    const res = await request(app)
      .post(`/api/episodes/${episodeId}/revisions`)
      .send({
        content: '第二版内容，修正了错误。',
        message: '修正错别字',
        author: 'TestUser',
        source: 'community_edit'
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('sha');
    expect(res.body).toHaveProperty('message', '修正错别字');
    expect(res.body).toHaveProperty('author', 'TestUser');
    expect(res.body).toHaveProperty('source', 'community_edit');
    // Verify transcript content was updated
    const transcriptRes = await request(app).get(`/api/episodes/${episodeId}/transcript`);
    expect(transcriptRes.body.content).toBe('第二版内容，修正了错误。');
  });

  test('GET /api/episodes/:id/revisions returns 2 revisions after edit', async () => {
    const res = await request(app).get(`/api/episodes/${episodeId}/revisions`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    // Most recent first
    expect(res.body[0].message).toBe('修正错别字');
  });

  test('POST /api/episodes/:id/revisions/:sha/restore creates revert commit', async () => {
    const res = await request(app)
      .post(`/api/episodes/${episodeId}/revisions/${revSha}/restore`)
      .send({ author: 'RestoreUser' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('sha');
    expect(res.body).toHaveProperty('source', 'revert');
    expect(res.body.message).toMatch(/回滚/);
    // Transcript should now have original content
    const transcriptRes = await request(app).get(`/api/episodes/${episodeId}/transcript`);
    expect(transcriptRes.body.content).toBe('第一版内容。');
  });

  test('GET /api/episodes/:id/revisions returns 3 revisions after restore', async () => {
    const res = await request(app).get(`/api/episodes/${episodeId}/revisions`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(3);
    expect(res.body[0].source).toBe('revert');
  });

  test('POST /api/episodes/:id/revisions requires content', async () => {
    const res = await request(app)
      .post(`/api/episodes/${episodeId}/revisions`)
      .send({ message: 'No content here' });
    expect(res.status).toBe(400);
  });

  test('GET /api/episodes/:id/revisions/:sha returns 404 for invalid sha', async () => {
    const res = await request(app).get(`/api/episodes/${episodeId}/revisions/deadbeefdeadbeef`);
    expect(res.status).toBe(404);
  });
});
