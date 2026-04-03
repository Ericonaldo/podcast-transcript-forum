#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { getDb, closeDb } = require('../server/src/db');
const API_KEY = process.env.LLM_API_KEY;
const API_URL = process.env.LLM_API_URL || 'http://38.246.250.87:3000/v1/chat/completions';
const MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const PODCAST_ID = 23;
const HOST_NAME = 'Dwarkesh Patel';
const SOURCE_RECOVERY_IDS = new Set([353, 354, 355, 356, 368]);
const OFFICIAL_TRANSCRIPT_URLS = {
  354: 'https://www.dwarkesh.com/p/sarah-paine-cold-war',
  355: 'https://www.dwarkesh.com/p/ilya-sutskever-2',
  356: 'https://www.dwarkesh.com/p/satya-nadella',
  368: 'https://www.dwarkesh.com/p/sarah-paine-east-asia',
};
const args = process.argv.slice(2);
const onlyEpisodes = new Set(
  (args.find(arg => arg.startsWith('--episodes='))?.split('=')[1] || '')
    .split(',')
    .map(v => Number(v.trim()))
    .filter(Boolean)
);

function stripVtt(vtt) {
  return vtt
    .replace(/^WEBVTT.*$/gm, '')
    .replace(/^\d+$/gm, '')
    .replace(/^\d{2}:\d{2}:\d{2}\.\d+\s+-->\s+\d{2}:\d{2}:\d{2}\.\d+.*$/gm, '')
    .replace(/^\d{2}:\d{2}\.\d+\s+-->\s+\d{2}:\d{2}\.\d+.*$/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .reduce((acc, line) => {
      if (!acc.length || acc[acc.length - 1] !== line) acc.push(line);
      return acc;
    }, [])
    .join('\n');
}

function normalizeSpeakerTagMarkup(content) {
  return content
    .replace(/\*\*\[([^\]]+?)[：:]\]\*\*/g, '**[$1]**')
    .replace(/\*\*\[([^\]]+)\]\*\*[：:]\s*/g, '**[$1]** ')
    .replace(/\*\*([^*\n]{1,60}?)[：:]\*\*/g, '**[$1]**')
    .replace(/(^|\n)\*\*([^*\[\]\n]{1,60}?)\*\*(\s)/g, (m, pre, name, sp) => `${pre}**[${name.trim()}]**${sp}`)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getGuestName(episode) {
  if (episode.guests) return episode.guests.trim();

  const title = episode.title;
  const prefixMatch = title.match(/^([^—–-]{2,80}?)\s+[—–-]\s+/);
  if (prefixMatch) {
    const candidate = prefixMatch[1].trim();
    if (!/^(Why|What|Some thoughts|Fully autonomous|Artificial meat|Evolution designed|China is killing|The most important)/i.test(candidate)) {
      return candidate;
    }
  }

  const suffixMatch = title.match(/\s+[—–-]\s+([^—–-]{2,80})$/);
  if (suffixMatch) return suffixMatch[1].trim();

  const descLead = episode.description?.match(/^([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})\s+(?:is|thinks|has|,)/);
  if (descLead) return descLead[1].trim();

  return null;
}

function canonicalizePolish(content, episode) {
  let fixed = normalizeSpeakerTagMarkup(content);
  const guestName = getGuestName(episode);

  const replacements = new Map([
    ['Dwarkesh', HOST_NAME],
    ['Dwarkesh Patel', HOST_NAME],
    ['Host', HOST_NAME],
    ['主持人', HOST_NAME],
  ]);

  if (guestName) {
    for (const generic of ['Guest', '嘉宾', 'Speaker 1', 'Unknown Speaker', 'UNKNOWN', 'Unknown']) {
      replacements.set(generic, guestName);
    }
  }

  for (const [from, to] of replacements.entries()) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    fixed = fixed.replace(new RegExp(`\\*\\*\\[${escaped}\\]\\*\\*`, 'g'), `**[${to}]**`);
  }

  fixed = normalizeSpeakerTagMarkup(fixed);

  return fixed;
}

async function callLLM(messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    signal: controller.signal,
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 4096,
    }),
  });
  clearTimeout(timer);

  if (!response.ok) {
    throw new Error(`LLM ${response.status}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

function fetchEnglishSubtitles(url) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dwarkesh-subs-'));
  const outputTemplate = path.join(tmpDir, '%(id)s.%(ext)s');
  const result = spawnSync(
    'yt-dlp',
    [
      '--cookies',
      'cookies.txt',
      '--skip-download',
      '--write-sub',
      '--sub-langs',
      'en',
      '--output',
      outputTemplate,
      url,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 180000,
    }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'yt-dlp failed');
  }

  const file = fs.readdirSync(tmpDir).find(name => name.endsWith('.en.vtt'));
  if (!file) throw new Error('No English subtitle file downloaded');
  const content = fs.readFileSync(path.join(tmpDir, file), 'utf8');
  return { vtt: content, text: stripVtt(content) };
}

function fetchOfficialPage(url) {
  const result = spawnSync('curl', ['-L', '--max-time', '30', url], {
    encoding: 'utf8',
    timeout: 60000,
  });
  if (result.status !== 0) throw new Error(result.stderr || 'curl failed');
  return result.stdout;
}

function parseOfficialTranscript(html, episode) {
  const tmpHtml = path.join(os.tmpdir(), `dwarkesh-${episode.id}.html`);
  fs.writeFileSync(tmpHtml, html, 'utf8');
  const guestName = getGuestName(episode) || '';
  const parser = spawnSync(
    'python3',
    [
      '-c',
      `
from bs4 import BeautifulSoup
import sys,re
html=open(sys.argv[1], 'r', encoding='utf-8').read()
host=sys.argv[2]
guest=sys.argv[3]
soup=BeautifulSoup(html, 'html.parser')
items=list(soup.stripped_strings)
start=-1
for i,item in enumerate(items):
    if item == 'Transcript' and i + 1 < len(items) and re.search(r'\\d{1,2}:\\d{2}:\\d{2}', items[i+1]):
        start=i+1
        break
if start < 0:
    raise SystemExit('no transcript block')
stop_markers={'Ready for more?','Comments','Discussion about this post','Get the app'}
cur=None
buf=[]
out=[]
def flush():
    global buf
    if cur and buf:
        out.append(f"**[{cur}]** {' '.join(buf).strip()}")
    buf=[]
for token in items[start:]:
    if token in stop_markers:
        break
    if re.match(r'^\\(?\\d{1,2}:\\d{2}:\\d{2}\\)?(?:\\s+[–-]\\s+.*)?$', token):
        continue
    if token in {host, guest}:
        flush()
        cur=token
        continue
    if not cur:
        continue
    buf.append(token)
flush()
print('\\n\\n'.join(out))
      `,
      tmpHtml,
      HOST_NAME,
      guestName,
    ],
    { encoding: 'utf8', timeout: 30000 }
  );

  if (parser.status !== 0 || !parser.stdout.trim()) {
    throw new Error(parser.stderr || parser.stdout || 'official transcript parse failed');
  }
  return normalizeSpeakerTagMarkup(parser.stdout.trim());
}

async function translateToEnglish(sourceText, episode) {
  const system = `You are repairing a podcast transcript source.
Translate the source into natural English while preserving meaning, order, and paragraph structure.
Do not summarize.
Return plain English transcript text only.`;

  const user = `Episode title: ${episode.title}
Description: ${(episode.description || '').slice(0, 400)}

Source text:
${sourceText.slice(0, 12000)}`;

  return await callLLM([{ role: 'system', content: system }, { role: 'user', content: user }]);
}

async function translateTaggedTranscriptToEnglish(taggedContent, episode) {
  const chunks = [];
  let current = '';
  for (const part of taggedContent.split(/\n\n+/)) {
    if (!part.trim()) continue;
    if ((current + '\n\n' + part).length > 3500 && current) {
      chunks.push(current);
      current = part;
    } else {
      current += (current ? '\n\n' : '') + part;
    }
  }
  if (current) chunks.push(current);

  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    const system = `Translate this transcript chunk into natural English.
Preserve all **[Speaker]** labels exactly as they appear.
Preserve paragraph order and structure.
Do not summarize or omit content.
Return transcript text only.`;
    const user = `Episode title: ${episode.title}
Chunk ${i + 1}/${chunks.length}

${chunks[i]}`;
    out.push(await callLLM([{ role: 'system', content: system }, { role: 'user', content: user }]));
  }

  return normalizeSpeakerTagMarkup(out.join('\n\n'));
}

function choosePreferredTranslation(rows) {
  return [...rows].sort((a, b) => {
    if (a.updated_at !== b.updated_at) return a.updated_at > b.updated_at ? -1 : 1;
    if (a.content.length !== b.content.length) return b.content.length - a.content.length;
    return b.id - a.id;
  })[0];
}

async function repair() {
  const db = getDb();
  const episodes = db
    .prepare('SELECT id, title, description, guests, episode_url FROM episodes WHERE podcast_id=? ORDER BY id')
    .all(PODCAST_ID)
    .filter(episode => onlyEpisodes.size === 0 || onlyEpisodes.has(episode.id));

  const byEpisode = new Map();
  const transcripts = db
    .prepare('SELECT * FROM transcripts WHERE episode_id IN (SELECT id FROM episodes WHERE podcast_id=?) ORDER BY episode_id, source, updated_at, id')
    .all(PODCAST_ID);
  for (const transcript of transcripts) {
    if (!byEpisode.has(transcript.episode_id)) byEpisode.set(transcript.episode_id, []);
    byEpisode.get(transcript.episode_id).push(transcript);
  }

  const updateTranscript = db.prepare('UPDATE transcripts SET content=?, language=?, updated_at=CURRENT_TIMESTAMP WHERE id=?');
  const deleteTranscript = db.prepare('DELETE FROM transcripts WHERE id=?');
  for (const episode of episodes) {
    console.log(`\n[ep${episode.id}] ${episode.title}`);
    const rows = byEpisode.get(episode.id) || [];
    const polish = rows.find(row => row.source === 'llm_polish');
    const source = rows.find(row => row.source === 'youtube_manual' || row.source === 'youtube_auto');
    const translates = rows.filter(row => row.source === 'llm_translate');

    if (translates.length > 1) {
      console.log(`  dedupe llm_translate: ${translates.length} -> 1`);
      const keep = choosePreferredTranslation(translates);
      for (const row of translates) {
        if (row.id !== keep.id) deleteTranscript.run(row.id);
      }
    }

    if (SOURCE_RECOVERY_IDS.has(episode.id) && source) {
      console.log('  recover source transcript');
      let recoveredText;
      let recoveredRaw;
      let rebuiltFromOfficial = null;

      if (episode.id === 353) {
        console.log('  translate zh source back to English');
        recoveredText = await translateToEnglish(source.content, episode);
        recoveredRaw = recoveredText;
      } else if (OFFICIAL_TRANSCRIPT_URLS[episode.id]) {
        console.log('  fetch official transcript page');
        const html = fetchOfficialPage(OFFICIAL_TRANSCRIPT_URLS[episode.id]);
        rebuiltFromOfficial = parseOfficialTranscript(html, episode);
        recoveredText = rebuiltFromOfficial.replace(/\*\*\[[^\]]+\]\*\*\s*/g, '').trim();
        recoveredRaw = recoveredText;
      } else {
        console.log('  fetch English subtitles from YouTube');
        const subtitle = fetchEnglishSubtitles(episode.episode_url);
        recoveredText = subtitle.text;
        recoveredRaw = subtitle.vtt;
      }

      updateTranscript.run(recoveredRaw, 'en', source.id);

      if (polish) {
        console.log('  rebuild llm_polish in English');
        const rebuilt = rebuiltFromOfficial || (polish.language === 'zh'
          ? await translateTaggedTranscriptToEnglish(polish.content, episode)
          : canonicalizePolish(polish.content, episode));
        updateTranscript.run(rebuilt, 'en', polish.id);
      }
    } else if (polish) {
      console.log('  canonicalize polished speaker labels');
      const fixed = canonicalizePolish(polish.content, episode);
      updateTranscript.run(fixed, polish.language || 'en', polish.id);
    }
  }

  // Second pass after source recovery to canonicalize all polished transcripts uniformly.
  for (const episode of episodes) {
    const polish = db.prepare("SELECT id, content, language FROM transcripts WHERE episode_id=? AND source='llm_polish'").get(episode.id);
    if (!polish) continue;
    const fixed = canonicalizePolish(polish.content, episode);
    updateTranscript.run(fixed, polish.language || 'en', polish.id);
  }

  console.log('\nRepair pass complete.');

  closeDb();
}

if (!API_KEY) {
  console.error('LLM_API_KEY is required');
  process.exit(1);
}

repair().catch(error => {
  console.error(error);
  closeDb();
  process.exit(1);
});
