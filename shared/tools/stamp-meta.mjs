/* Menstempel tag pratinjau tautan tiap widget ke shim docs-nya, dari catalog.js.

   Crawler (Discord, iMessage, Slack) tidak menjalankan JS dan Pages tidak merender
   di sisi server, jadi tag og: harus berupa byte nyata di berkas. Ini memproyeksikan
   tag tersebut ke sana, sehingga satu-satunya field tulis-tangan di shim adalah id.

   Jalankan: node shared/tools/stamp-meta.mjs   (pre-commit hook melakukannya) */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const START = '<!-- meta:start';
const END = '<!-- meta:end -->';

const read = (p) => readFile(path.join(ROOT, p), 'utf8');

// Kedua berkas konfigurasi adalah assignment `window.X = ...` polos, jadi mengevaluasinya
// terhadap stub lebih baik daripada memelihara parser kedua yang harus sinkron.
async function load(...files) {
  const g = {};
  for (const f of files) new Function('window', await read(f))(g);
  return g;
}

// Set yang sama dengan CHROME.esc — dua deskripsi memuat '&' literal.
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function block(c, site) {
  const url = (p) => new URL(p, site.origin.replace(/\/*$/, '/')).href;
  const tag = (s) => '  ' + s;
  const lines = [
    `${START} — dibuat dari shared/core/catalog.js oleh shared/tools/stamp-meta.mjs. Jangan diedit manual. -->`,
    `<title>${esc(c.name)} — Panduan Pasang</title>`,
    `<meta name="description" content="${esc(c.description || '')}">`,
    '<meta property="og:type" content="article">',
    `<meta property="og:site_name" content="${esc(site.brand || '')}">`,
    `<meta property="og:url" content="${esc(url(c.docsUrl))}">`,
    `<meta property="og:title" content="${esc(c.name)}">`,
    `<meta property="og:description" content="${esc(c.description || '')}">`,
  ];
  // Tanpa thumb tidak ada banner — embed turun ke judul dan deskripsi.
  if (c.thumb) lines.push(`<meta property="og:image" content="${esc(url(c.thumb))}">`);
  lines.push('<!-- Garis kiri embed Discord. -->');
  lines.push(`<meta name="theme-color" content="${esc(c.accent || '#3b82f6')}">`);
  if (c.thumb) lines.push('<meta name="twitter:card" content="summary_large_image">');
  lines.push(END);
  return lines.map(tag).join('\n');
}

const { CATALOG = [], SITE = {} } = await load('shared/core/catalog.js', 'shared/core/site.js');
let changed = 0, failed = 0;

for (const c of CATALOG) {
  if (!c.docsUrl) continue;
  const rel = path.posix.join(c.docsUrl, 'index.html');
  let html;
  try {
    html = await read(rel);
  } catch {
    console.error(`  ${rel}  TIDAK ADA`);
    failed++;
    continue;
  }

  const a = html.indexOf(START), b = html.indexOf(END);
  if (a < 0 || b < a) {
    console.error(`  ${rel}  tidak ada penanda ${START} … ${END} — salin dari shim docs lain`);
    failed++;
    continue;
  }

  // Ikuti line-ending berkasnya sendiri — autocrlf memberi CRLF pada sebagian checkout.
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  const stamped = block(c, SITE).trimStart().replace(/\n/g, eol);
  const next = html.slice(0, a) + stamped + html.slice(b + END.length);
  if (next === html) { console.log(`  ${rel}  tidak berubah`); continue; }
  await writeFile(path.join(ROOT, rel), next, 'utf8');
  console.log(`  ${rel}  diperbarui`);
  changed++;
}

console.log(`${changed} berkas diubah.`);
process.exit(failed ? 1 : 0);
