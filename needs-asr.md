# 播客文稿待处理报告
*Generated: 2026-03-20*

## 概述

以下播客/节目缺少文字稿，需要通过 ASR（自动语音识别）或 OCR 进一步处理。

**统计**:
- 已爬取新节目: 10
- 已导入文字稿: 10
- 待处理节目数: 103

---

## 一、已知中文播客平台（无公开文稿接口）

这些平台无法自动爬取文字稿，建议使用 **EchoShell Chrome插件** 在收听时实时转录。

| 平台 | 说明 | 建议操作 |
|------|------|----------|
| **小宇宙 (xiaoyuzhou.fm)** | 国内最大中文播客平台，无公开RSS/API，需要OCR或ASR处理 | Use EchoShell Chrome extension with ASR to capture audio |
| **喜马拉雅 (ximalaya.com)** | 综合音频平台，部分节目有自动字幕，需通过API或ASR提取 | Check individual episode pages for auto-captions, or use ASR |
| **荔枝播客 (lizhi.fm)** | 中文播客平台，无统一字幕系统 | Use ASR on audio files |
| **网易云音乐播客** | 网易云音乐播客区，无字幕系统 | Use ASR on audio files |
| **得到App播客** | 得到App专属内容，有AI转录功能但不开放 | Use EchoShell to capture and transcribe while listening |
| **Spotify Podcasts (中文)** | 部分中文节目有Spotify自动转录，需登录访问 | Use Spotify API with OAuth or manual capture |

---

## 二、RSS已收录但无文字稿的节目

以下节目已通过RSS收录到数据库，但没有找到可用的文字稿：

### Lex Fridman Podcast

| 节目标题 | 发布日期 | 原因 | 建议操作 |
|----------|----------|------|----------|
| [#493 – Jeff Kaplan: World of Warcraft, Overwatch, ](https://media.blubrry.com/takeituneasy/ins.blubrry.com/takeituneasy/lex_ai_jeff_kaplan.mp3) | 2026-03-11 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [#492 – Rick Beato: Greatest Guitarists of All Time](https://media.blubrry.com/takeituneasy/ins.blubrry.com/takeituneasy/lex_ai_rick_beato.mp3) | 2026-03-01 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [#491 – OpenClaw: The Viral AI Agent that Broke the](https://media.blubrry.com/takeituneasy/ins.blubrry.com/takeituneasy/lex_ai_peter_steinberger.mp3) | 2026-02-12 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [#490 – State of AI in 2026: LLMs, Coding, Scaling ](https://media.blubrry.com/takeituneasy/ins.blubrry.com/takeituneasy/lex_ai_ai_sota_2026.mp3) | 2026-02-01 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [#489 – Paul Rosolie: Uncontacted Tribes in the Ama](https://media.blubrry.com/takeituneasy/ins.blubrry.com/takeituneasy/lex_ai_paul_rosolie_3.mp3) | 2026-01-13 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [#488 – Infinity, Paradoxes that Broke Mathematics,](https://media.blubrry.com/takeituneasy/ins.blubrry.com/takeituneasy/lex_ai_joel_david_hamkins.mp3) | 2025-12-31 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [#487 – Irving Finkel: Deciphering Secrets of Ancie](https://media.blubrry.com/takeituneasy/ins.blubrry.com/takeituneasy/lex_ai_irving_finkel.mp3) | 2025-12-12 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [#486 – Michael Levin: Hidden Reality of Alien Inte](https://media.blubrry.com/takeituneasy/ins.blubrry.com/takeituneasy/lex_ai_michael_levin_2.mp3) | 2025-11-30 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [#485 – David Kirtley: Nuclear Fusion, Plasma Physi](https://media.blubrry.com/takeituneasy/ins.blubrry.com/takeituneasy/lex_ai_david_kirtley.mp3) | 2025-11-17 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [#484 – Dan Houser: GTA, Red Dead Redemption, Rocks](https://media.blubrry.com/takeituneasy/content.blubrry.com/takeituneasy/lex_ai_dan_houser.mp3) | 2025-10-31 | Audio only - needs ASR | Run Whisper ASR on audio file |

*... 及其他 10 个节目*

### a16z Podcast

| 节目标题 | 发布日期 | 原因 | 建议操作 |
|----------|----------|------|----------|
| [Who Is Winning the War in Iran?](https://dts.podtrac.com/redirect.mp3/pdst.fm/e/pfx.vpixl.com/6qj4J/pscrb.fm/rss/p/nyt.simplecastaudio.com/03d8b493-87fc-4bd1-931f-8a8e9b945d8a/episodes/d37a18bc-bb2a-4a59-bb45-c7ffbfb8f4d0/audio/128/default.mp3?aid=rss_feed&amp;awCollectionId=03d8b493-87fc-4bd1-931f-8a8e9b945d8a&amp;awEpisodeId=d37a18bc-bb2a-4a59-bb45-c7ffbfb8f4d0&amp;feed=54nAGcIl) | 2026-03-19 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Inside the Government’s Crackdown on TV](https://dts.podtrac.com/redirect.mp3/pdst.fm/e/pfx.vpixl.com/6qj4J/pscrb.fm/rss/p/nyt.simplecastaudio.com/03d8b493-87fc-4bd1-931f-8a8e9b945d8a/episodes/1c2e023b-561d-48e1-a868-f7dbc88d8c38/audio/128/default.mp3?aid=rss_feed&amp;awCollectionId=03d8b493-87fc-4bd1-931f-8a8e9b945d8a&amp;awEpisodeId=1c2e023b-561d-48e1-a868-f7dbc88d8c38&amp;feed=54nAGcIl) | 2026-03-18 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Chosen by War: The Rise of Iran’s New Supreme Lead](https://dts.podtrac.com/redirect.mp3/pdst.fm/e/pfx.vpixl.com/6qj4J/pscrb.fm/rss/p/nyt.simplecastaudio.com/03d8b493-87fc-4bd1-931f-8a8e9b945d8a/episodes/82f851da-1e63-483d-ac72-dd40137c64a9/audio/128/default.mp3?aid=rss_feed&amp;awCollectionId=03d8b493-87fc-4bd1-931f-8a8e9b945d8a&amp;awEpisodeId=82f851da-1e63-483d-ac72-dd40137c64a9&amp;feed=54nAGcIl) | 2026-03-17 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [A War Within the War: Israel’s Bombardment of Leba](https://dts.podtrac.com/redirect.mp3/pdst.fm/e/pfx.vpixl.com/6qj4J/pscrb.fm/rss/p/nyt.simplecastaudio.com/03d8b493-87fc-4bd1-931f-8a8e9b945d8a/episodes/4bd0eba6-f266-4e21-ab64-13f540e39043/audio/128/default.mp3?aid=rss_feed&amp;awCollectionId=03d8b493-87fc-4bd1-931f-8a8e9b945d8a&amp;awEpisodeId=4bd0eba6-f266-4e21-ab64-13f540e39043&amp;feed=54nAGcIl) | 2026-03-16 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [The Sunday Daily: To Save His Life, Our Food Criti](https://dts.podtrac.com/redirect.mp3/pdst.fm/e/pfx.vpixl.com/6qj4J/pscrb.fm/rss/p/nyt.simplecastaudio.com/03d8b493-87fc-4bd1-931f-8a8e9b945d8a/episodes/65841f18-8d61-4a92-b7d4-3dcd3796e905/audio/128/default.mp3?aid=rss_feed&amp;awCollectionId=03d8b493-87fc-4bd1-931f-8a8e9b945d8a&amp;awEpisodeId=65841f18-8d61-4a92-b7d4-3dcd3796e905&amp;feed=54nAGcIl) | 2026-03-15 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [&apos;The Interview&apos;: How Tragedy, Wealth and](https://dts.podtrac.com/redirect.mp3/pdst.fm/e/pfx.vpixl.com/6qj4J/pscrb.fm/rss/p/nyt.simplecastaudio.com/03d8b493-87fc-4bd1-931f-8a8e9b945d8a/episodes/0fdbcb45-20e8-41a9-8121-19bc3009db1c/audio/128/default.mp3?aid=rss_feed&amp;awCollectionId=03d8b493-87fc-4bd1-931f-8a8e9b945d8a&amp;awEpisodeId=0fdbcb45-20e8-41a9-8121-19bc3009db1c&amp;feed=54nAGcIl) | 2026-03-14 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [The Case of Kristie Metcalfe](https://dts.podtrac.com/redirect.mp3/pdst.fm/e/pfx.vpixl.com/6qj4J/pscrb.fm/rss/p/nyt.simplecastaudio.com/03d8b493-87fc-4bd1-931f-8a8e9b945d8a/episodes/c2b6bb1a-5bd1-4266-a7ef-882710ea1337/audio/128/default.mp3?aid=rss_feed&amp;awCollectionId=03d8b493-87fc-4bd1-931f-8a8e9b945d8a&amp;awEpisodeId=c2b6bb1a-5bd1-4266-a7ef-882710ea1337&amp;feed=54nAGcIl) | 2026-03-13 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [The U.S. Errors That Led to the Airstrike on an El](https://dts.podtrac.com/redirect.mp3/pdst.fm/e/pfx.vpixl.com/6qj4J/pscrb.fm/rss/p/nyt.simplecastaudio.com/03d8b493-87fc-4bd1-931f-8a8e9b945d8a/episodes/328dae16-e6c2-4469-be7a-7c4b992fbc62/audio/128/default.mp3?aid=rss_feed&amp;awCollectionId=03d8b493-87fc-4bd1-931f-8a8e9b945d8a&amp;awEpisodeId=328dae16-e6c2-4469-be7a-7c4b992fbc62&amp;feed=54nAGcIl) | 2026-03-12 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [War in Iran Triggers Chaos in Global Oil Market](https://dts.podtrac.com/redirect.mp3/pdst.fm/e/pfx.vpixl.com/6qj4J/pscrb.fm/rss/p/nyt.simplecastaudio.com/03d8b493-87fc-4bd1-931f-8a8e9b945d8a/episodes/bf1f0b32-d38c-4af5-8abe-2fb2fd4d78ba/audio/128/default.mp3?aid=rss_feed&amp;awCollectionId=03d8b493-87fc-4bd1-931f-8a8e9b945d8a&amp;awEpisodeId=bf1f0b32-d38c-4af5-8abe-2fb2fd4d78ba&amp;feed=54nAGcIl) | 2026-03-11 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [What We’ve Learned From 10 Days of War](https://dts.podtrac.com/redirect.mp3/pdst.fm/e/pfx.vpixl.com/6qj4J/pscrb.fm/rss/p/nyt.simplecastaudio.com/03d8b493-87fc-4bd1-931f-8a8e9b945d8a/episodes/aa9519eb-db83-431a-8125-b7af4c0f1ded/audio/128/default.mp3?aid=rss_feed&amp;awCollectionId=03d8b493-87fc-4bd1-931f-8a8e9b945d8a&amp;awEpisodeId=aa9519eb-db83-431a-8125-b7af4c0f1ded&amp;feed=54nAGcIl) | 2026-03-10 | Audio only - needs ASR | Run Whisper ASR on audio file |

*... 及其他 10 个节目*

### Planet Money

| 节目标题 | 发布日期 | 原因 | 建议操作 |
|----------|----------|------|----------|
| [The little pet fish that saved a town in the Amazo](https://tracking.swap.fm/track/XvDEoI11TR00olTUO8US/prfx.byspotify.com/e/play.podtrac.com/npr-510289/npr.simplecastaudio.com/43b5acee-463e-4612-95ad-d2596d9dd337/episodes/f154f718-8639-418f-b486-9f1bf903766f/audio/128/default.mp3?awCollectionId=43b5acee-463e-4612-95ad-d2596d9dd337&amp;awEpisodeId=f154f718-8639-418f-b486-9f1bf903766f&amp;feed=hvWWWzRv&amp;t=podcast&amp;e=nx-s1-5751251&amp;p=510289&amp;d=1995&amp;size=31928408) | 2026-03-18 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Chef vs. Robot](https://tracking.swap.fm/track/XvDEoI11TR00olTUO8US/prfx.byspotify.com/e/play.podtrac.com/npr-510289/npr.simplecastaudio.com/43b5acee-463e-4612-95ad-d2596d9dd337/episodes/f64a8769-6041-414c-918c-a5f0002c5c73/audio/128/default.mp3?awCollectionId=43b5acee-463e-4612-95ad-d2596d9dd337&amp;awEpisodeId=f64a8769-6041-414c-918c-a5f0002c5c73&amp;feed=hvWWWzRv&amp;t=podcast&amp;e=nx-s1-5733110&amp;p=510289&amp;d=1540&amp;size=24656754) | 2026-03-13 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [The laws of the office revisited](https://tracking.swap.fm/track/XvDEoI11TR00olTUO8US/prfx.byspotify.com/e/play.podtrac.com/npr-510289/npr.simplecastaudio.com/43b5acee-463e-4612-95ad-d2596d9dd337/episodes/bcdc515d-980a-406a-80af-472268f426df/audio/128/default.mp3?awCollectionId=43b5acee-463e-4612-95ad-d2596d9dd337&amp;awEpisodeId=bcdc515d-980a-406a-80af-472268f426df&amp;feed=hvWWWzRv&amp;t=podcast&amp;e=nx-s1-5726849&amp;p=510289&amp;d=1775&amp;size=28414207) | 2026-03-11 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Planet Money vs. the NBA’s tanking problem](https://tracking.swap.fm/track/XvDEoI11TR00olTUO8US/prfx.byspotify.com/e/play.podtrac.com/npr-510289/traffic.megaphone.fm/NPR3439275766.mp3?t=podcast&amp;e=nx-s1-5739178&amp;p=510289&amp;d=1820&amp;size=29128499) | 2026-03-06 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [The Business of Heated Rivalry](https://tracking.swap.fm/track/XvDEoI11TR00olTUO8US/prfx.byspotify.com/e/play.podtrac.com/npr-510289/npr.simplecastaudio.com/43b5acee-463e-4612-95ad-d2596d9dd337/episodes/094bb7b7-9322-40e8-8298-d7b8b6f307e2/audio/128/default.mp3?awCollectionId=43b5acee-463e-4612-95ad-d2596d9dd337&amp;awEpisodeId=094bb7b7-9322-40e8-8298-d7b8b6f307e2&amp;t=podcast&amp;e=nx-s1-5736077&amp;p=510289&amp;d=1666&amp;size=26671317) | 2026-03-04 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Don't hate the replicator, hate the game](https://tracking.swap.fm/track/XvDEoI11TR00olTUO8US/prfx.byspotify.com/e/play.podtrac.com/npr-510289/npr.simplecastaudio.com/43b5acee-463e-4612-95ad-d2596d9dd337/episodes/d3fb9f5f-a17a-44ac-9eee-0267d2b37c36/audio/128/default.mp3?awCollectionId=43b5acee-463e-4612-95ad-d2596d9dd337&amp;awEpisodeId=d3fb9f5f-a17a-44ac-9eee-0267d2b37c36&amp;t=podcast&amp;e=nx-s1-5720653&amp;p=510289&amp;d=2164&amp;size=34627170) | 2026-02-27 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [The ICE hiring boom](https://tracking.swap.fm/track/XvDEoI11TR00olTUO8US/prfx.byspotify.com/e/play.podtrac.com/npr-510289/npr.simplecastaudio.com/43b5acee-463e-4612-95ad-d2596d9dd337/episodes/db163732-fa73-4803-802f-64338b6c56a8/audio/128/default.mp3?awCollectionId=43b5acee-463e-4612-95ad-d2596d9dd337&amp;awEpisodeId=db163732-fa73-4803-802f-64338b6c56a8&amp;t=podcast&amp;e=nx-s1-5725491&amp;p=510289&amp;d=1092&amp;size=17488336) | 2026-02-25 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [The Supreme Court struck down a bunch of Trump's t](https://tracking.swap.fm/track/XvDEoI11TR00olTUO8US/prfx.byspotify.com/e/play.podtrac.com/npr-510289/npr.simplecastaudio.com/43b5acee-463e-4612-95ad-d2596d9dd337/episodes/2c6f6ff2-e5ae-42ec-8809-7da20abee1c6/audio/128/default.mp3?awCollectionId=43b5acee-463e-4612-95ad-d2596d9dd337&amp;awEpisodeId=2c6f6ff2-e5ae-42ec-8809-7da20abee1c6&amp;t=podcast&amp;e=nx-s1-5721118&amp;p=510289&amp;d=1536&amp;size=24577341) | 2026-02-21 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [How to get what Greenland has, with permission](https://tracking.swap.fm/track/XvDEoI11TR00olTUO8US/prfx.byspotify.com/e/play.podtrac.com/npr-510289/npr.simplecastaudio.com/43b5acee-463e-4612-95ad-d2596d9dd337/episodes/c3285e67-3efe-4bd4-9c57-8401b8d77184/audio/128/default.mp3?awCollectionId=43b5acee-463e-4612-95ad-d2596d9dd337&amp;awEpisodeId=c3285e67-3efe-4bd4-9c57-8401b8d77184&amp;t=podcast&amp;e=nx-s1-5711616&amp;p=510289&amp;d=1634&amp;size=26158481) | 2026-02-18 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Betty Boop, Excel Olympics, Penny-isms: Our 2026 V](https://tracking.swap.fm/track/XvDEoI11TR00olTUO8US/prfx.byspotify.com/e/play.podtrac.com/npr-510289/npr.simplecastaudio.com/43b5acee-463e-4612-95ad-d2596d9dd337/episodes/708aa4b8-551d-4d85-9184-a68120623236/audio/128/default.mp3?awCollectionId=43b5acee-463e-4612-95ad-d2596d9dd337&amp;awEpisodeId=708aa4b8-551d-4d85-9184-a68120623236&amp;t=podcast&amp;e=nx-s1-5713954&amp;p=510289&amp;d=1902&amp;size=30445488) | 2026-02-13 | YouTube transcript unavailable (no captions) | Run ASR on audio or wait for YouTube auto-captions |

*... 及其他 10 个节目*

### How I Built This

| 节目标题 | 发布日期 | 原因 | 建议操作 |
|----------|----------|------|----------|
| [Advice Line: What’s Your Value?](https://rss.art19.com/episodes/41afea37-5bbc-4d40-9073-e28297ff2669.mp3?rss_browser=BAhJIhZQb2RTY3JpYmUtQ3Jhd2xlcgY6BkVU--7f8eb55d9c17aa2cb8175624f5739189217bc09a) | 2026-03-19 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Scrub Daddy: Aaron Krause. How a Failed Experiment](https://rss.art19.com/episodes/9609b7d2-5270-4914-ad99-28b040617c88.mp3?rss_browser=BAhJIhZQb2RTY3JpYmUtQ3Jhd2xlcgY6BkVU--7f8eb55d9c17aa2cb8175624f5739189217bc09a) | 2026-03-16 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Advice Line with Hernan Lopez of Wondery](https://rss.art19.com/episodes/5e7618a4-69e2-4198-987c-b92d18fb4381.mp3?rss_browser=BAhJIhZQb2RTY3JpYmUtQ3Jhd2xlcgY6BkVU--7f8eb55d9c17aa2cb8175624f5739189217bc09a) | 2026-03-12 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Bobo’s: Beryl Stafford. A Single Mom Turns a Bakin](https://rss.art19.com/episodes/48343128-e57d-4e61-999d-2cf9d30ed2fd.mp3?rss_browser=BAhJIhZQb2RTY3JpYmUtQ3Jhd2xlcgY6BkVU--7f8eb55d9c17aa2cb8175624f5739189217bc09a) | 2026-03-09 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Advice Line with Miguel McKelvey of WeWork](https://rss.art19.com/episodes/55948622-6c65-432f-915b-a35d524f9588.mp3?rss_browser=BAhJIhZQb2RTY3JpYmUtQ3Jhd2xlcgY6BkVU--7f8eb55d9c17aa2cb8175624f5739189217bc09a) | 2026-03-05 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Kettle Chips: Cameron Healy. The Wild Bet That Mad](https://rss.art19.com/episodes/f0b24729-a396-4512-a472-f0d05b75b9a9.mp3?rss_browser=BAhJIhZQb2RTY3JpYmUtQ3Jhd2xlcgY6BkVU--7f8eb55d9c17aa2cb8175624f5739189217bc09a) | 2026-03-02 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Advice Line with Alexa Hirschfeld of Paperless Pos](https://rss.art19.com/episodes/3d6d1f95-0cdc-458c-9620-a84e3f509aae.mp3?rss_browser=BAhJIhZQb2RTY3JpYmUtQ3Jhd2xlcgY6BkVU--7f8eb55d9c17aa2cb8175624f5739189217bc09a) | 2026-02-26 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Square: Jim McKelvey. He Lost a $2,000 Sale, Then ](https://rss.art19.com/episodes/1fb07edf-0cc3-4a66-a1d6-0222945c5102.mp3?rss_browser=BAhJIhZQb2RTY3JpYmUtQ3Jhd2xlcgY6BkVU--7f8eb55d9c17aa2cb8175624f5739189217bc09a) | 2026-02-23 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Advice Line with Pete Maldonado and Rashid Ali of ](https://rss.art19.com/episodes/44567442-1a5d-4d8f-a768-b498af82ee6a.mp3?rss_browser=BAhJIhZQb2RTY3JpYmUtQ3Jhd2xlcgY6BkVU--7f8eb55d9c17aa2cb8175624f5739189217bc09a) | 2026-02-19 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Spinbrush: John Osher. The Electric Toothbrush Tha](https://rss.art19.com/episodes/50af1881-7ff0-44ee-9ca9-39d1851c136a.mp3?rss_browser=BAhJIhZQb2RTY3JpYmUtQ3Jhd2xlcgY6BkVU--7f8eb55d9c17aa2cb8175624f5739189217bc09a) | 2026-02-16 | Audio only - needs ASR | Run Whisper ASR on audio file |

*... 及其他 10 个节目*

### Huberman Lab

| 节目标题 | 发布日期 | 原因 | 建议操作 |
|----------|----------|------|----------|
| [Essentials: Tools for Setting &amp; Achieving Goal](https://traffic.megaphone.fm/SCIM9175684945.mp3?updated=1773895307) | 2026-03-19 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Science-Based Meditation Tools to Improve Your Bra](https://traffic.megaphone.fm/SCIM1465874306.mp3?updated=1773641796) | 2026-03-16 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Essentials: Benefits of Sauna &amp; Deliberate Hea](https://traffic.megaphone.fm/SCIM1457876357.mp3?updated=1773641030) | 2026-03-12 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Avoiding, Treating &amp; Curing Cancer With the Im](https://traffic.megaphone.fm/SCIM5861479163.mp3?updated=1773031397) | 2026-03-09 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Essentials: The Biology of Taste Perception &amp; ](https://traffic.megaphone.fm/SCIM4352602150.mp3?updated=1773031283) | 2026-03-05 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Unlearn Negative Thoughts &amp; Behaviors Patterns](https://traffic.megaphone.fm/SCIM4778698454.mp3?updated=1772435461) | 2026-03-02 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Essentials: Using Light to Optimize Health](https://traffic.megaphone.fm/SCIM8775078173.mp3?updated=1772086171) | 2026-02-26 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Restore Youthfulness &amp; Vitality to the Aging B](https://traffic.megaphone.fm/SCIM5931542341.mp3?updated=1771826980) | 2026-02-23 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [Essentials: Optimize Your Exercise Program with Sc](https://traffic.megaphone.fm/SCIM7631643288.mp3?updated=1771484503) | 2026-02-19 | Audio only - needs ASR | Run Whisper ASR on audio file |
| [The Most Effective Weight Training, Cardio &amp; N](https://traffic.megaphone.fm/SCIM6891280189.mp3?updated=1771224091) | 2026-02-16 | Audio only - needs ASR | Run Whisper ASR on audio file |

*... 及其他 10 个节目*

---

## 三、推荐 ASR 工具

### 本地工具
- **Whisper** (OpenAI): `whisper audio.mp3 --language zh --model medium`
- **faster-whisper**: GPU加速版本，适合批量处理
- **whisper.cpp**: C++实现，CPU高效运行

### 云端 API
- **OpenAI Whisper API**: `POST https://api.openai.com/v1/audio/transcriptions`
- **Groq Whisper**: 免费额度大，速度快
- **Deepgram**: 支持中文，实时转录

### EchoShell 集成
EchoShell Chrome 插件已集成 BYOK ASR，可在收听播客时实时转录并上传到本 Forum。
- Forum 上传接口: `POST /api/upload`
- 查重接口: `GET /api/check?url=<episode_url>`

---

## 四、批量 ASR 脚本示例

```bash
# 使用 Whisper 批量转录音频文件
for mp3 in *.mp3; do
  whisper "$mp3" \
    --language zh \
    --model medium \
    --output_format vtt \
    --output_dir transcripts/
done
```

```bash
# 使用 Groq API 批量转录 (更快)
for mp3 in *.mp3; do
  curl -X POST https://api.groq.com/openai/v1/audio/transcriptions \
    -H "Authorization: Bearer $GROQ_API_KEY" \
    -F "file=@$mp3" \
    -F "model=whisper-large-v3" \
    -F "language=zh" \
    -F "response_format=vtt"
done
```
