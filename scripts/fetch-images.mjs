import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const envText = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
const API_KEY = envText.match(/PEXELS_API_KEY=(.+)/)[1].trim();

const OUTPUT_PATH = path.join(__dirname, 'images.json');
const APP_OUTPUT_PATH = path.join(ROOT, 'images.js');
const LIMIT = process.argv.includes('--limit')
  ? Number(process.argv[process.argv.indexOf('--limit') + 1])
  : null;
const DELAY_MS = 19000;

// data.js'dan so'zlar ro'yxatini yuklash (haqiqiy fayldan, qayta yozmasdan)
const dataSrc = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(dataSrc + '\n;globalThis.__wordsData = wordsData;', sandbox);
const wordsData = sandbox.__wordsData;

const uniqueWords = [...new Set(wordsData.map((w) => w.word))];
const targetWords = LIMIT ? uniqueWords.slice(0, LIMIT) : uniqueWords;

let results = {};
if (fs.existsSync(OUTPUT_PATH)) {
  results = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
}

function saveResults() {
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
  const forApp = {};
  for (const [word, img] of Object.entries(results)) {
    if (!img) continue;
    forApp[word] = { url: img.url, photographer: img.photographer, photographerUrl: img.photographerUrl, pexelsUrl: img.pexelsUrl };
  }
  fs.writeFileSync(APP_OUTPUT_PATH, 'const imagesData = ' + JSON.stringify(forApp) + ';\n');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function simplifyQuery(word) {
  return word.replace(/^(a|an|the|to)\s+/i, '').trim();
}

async function searchPexels(query) {
  const res = await fetch('https://api.pexels.com/v1/search?query=' + encodeURIComponent(query) + '&per_page=1', {
    headers: { Authorization: API_KEY },
  });
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = res.headers.get('x-ratelimit-reset');
  if (remaining !== null && Number(remaining) < 5) {
    const waitMs = reset ? Math.max(0, Number(reset) * 1000 - Date.now()) + 2000 : 60000;
    console.log(`  ⏳ Limitga yaqinlashdik (${remaining} qoldi), ${Math.round(waitMs / 1000)}s kutamiz...`);
    await sleep(waitMs);
  }
  if (!res.ok) {
    throw new Error('Pexels xatosi: ' + res.status + ' ' + (await res.text()));
  }
  return res.json();
}

async function fetchImageForWord(word) {
  let data = await searchPexels(word);
  let query = word;
  if (!data.photos || data.photos.length === 0) {
    const simplified = simplifyQuery(word);
    if (simplified !== word) {
      await sleep(DELAY_MS);
      data = await searchPexels(simplified);
      query = simplified;
    }
  }
  if (!data.photos || data.photos.length === 0) return null;
  const p = data.photos[0];
  return {
    query,
    url: p.src.medium,
    photographer: p.photographer,
    photographerUrl: p.photographer_url,
    pexelsUrl: p.url,
  };
}

async function main() {
  const todo = targetWords.filter((w) => !(w in results));
  console.log(`Jami so'z: ${targetWords.length}, oldin yig'ilgan: ${targetWords.length - todo.length}, qolgan: ${todo.length}`);

  for (let i = 0; i < todo.length; i++) {
    const word = todo[i];
    try {
      const img = await fetchImageForWord(word);
      results[word] = img;
      console.log(`[${i + 1}/${todo.length}] ${word} -> ${img ? img.url : 'TOPILMADI'}`);
    } catch (e) {
      console.error(`[${i + 1}/${todo.length}] ${word} -> XATO: ${e.message}`);
      results[word] = null;
    }
    saveResults();
    if (i < todo.length - 1) await sleep(DELAY_MS);
  }
  console.log('Tugadi.');
}

main();
