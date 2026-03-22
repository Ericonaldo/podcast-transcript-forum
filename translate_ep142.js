const Database = require('better-sqlite3');
const db = new Database('./data/podcast.db');

const API_KEY = 'sk-3ODOY96LmDCFgcBY1d1b586c01E448BcAbB5115bD8FbD2Fc';
const API_URL = 'http://38.246.250.87:3000/v1/chat/completions';

const content = db.prepare("SELECT content FROM transcripts WHERE id=860").get().content;

// Split into chunks of ~2500 chars
function splitChunks(text, maxLen = 2500) {
  const lines = text.split('\n');
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if (current.length + line.length > maxLen && current.length > 0) {
      chunks.push(current);
      current = line + '\n';
    } else {
      current += line + '\n';
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

async function translate(chunk, idx, total) {
  const prompt = `你是一个专业的播客文字稿翻译器。请将以下英文播客文字稿翻译成中文。

要求：
1. 保留所有时间戳 [MM:SS] 格式不变
2. 保留说话人标签格式不变（如 **[张小珺]**, **[Ola Källenius]** 等），康林松是Ola Källenius的中文名
3. 保留段落结构和换行
4. 翻译要自然流畅，符合中文播客文稿风格
5. 专业术语翻译准确（如NEV=新能源车，EV=电动车等）
6. [Music] 翻译为 [音乐]
7. 不要添加或删除任何内容

只输出翻译后的文稿，不要解释。`;

  for (let retry = 0; retry < 3; retry++) {
    try {
      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: chunk }
          ],
          temperature: 0.3,
          max_tokens: 4096
        })
      });
      const data = await resp.json();
      if (data.choices?.[0]?.message?.content) {
        console.log(`Chunk ${idx+1}/${total} translated`);
        return data.choices[0].message.content;
      }
      console.error(`Chunk ${idx+1} empty response, retry ${retry+1}`);
    } catch (e) {
      console.error(`Chunk ${idx+1} error: ${e.message}, retry ${retry+1}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return chunk; // fallback to original
}

async function main() {
  const chunks = splitChunks(content);
  console.log(`Split into ${chunks.length} chunks`);
  
  const translated = [];
  for (let i = 0; i < chunks.length; i++) {
    const result = await translate(chunks[i], i, chunks.length);
    translated.push(result);
    // Small delay between chunks
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
  }
  
  const zhContent = translated.join('\n\n');
  
  // Insert as new transcript
  db.prepare(`INSERT INTO transcripts (episode_id, content, format, language, source, created_at, updated_at) 
    VALUES (142, ?, 'plain', 'zh', 'llm_polish', datetime('now'), datetime('now'))`).run(zhContent);
  
  console.log('Chinese transcript saved successfully');
  console.log(`Length: ${zhContent.length} chars`);
  db.close();
}

main().catch(e => { console.error(e); db.close(); });
