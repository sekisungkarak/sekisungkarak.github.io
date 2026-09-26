/* Stamps each widget's link-preview tags into its docs shim, from catalog.js.

   Crawlers (Discord, iMessage, Slack) do not run JS and Pages does not render
   server-side, so the og: tags have to be real bytes in the file. This projects
   them there, which leaves the shim's only hand-written field as the id.

   Run: node shared/tools/stamp-meta.mjs   (the pre-commit hook does it) */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const START = '<!-- meta:start';
const END = '<!-- meta:end -->';

const read = (p) => readFile(path.join(ROOT, p), 'utf8');

// Both config files are plain `window.X = ...` assignments, so evaluating them
// against a stub beats maintaining a second parser that has to stay in sync.
async function load(...files) {
  const g = {};
  for (const f of files) new Function('window', await read(f))(g);
  return g;
}

// Same set as CHROME.esc — two descriptions contain a literal '&'.
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function block(c, site) {
  const url = (p) => new URL(p, site.origin.replace(/\/*$/, '/')).href;
  const tag = (s) => '  ' + s;
  const lines = [
    `${START} — generated from shared/core/catalog.js by shared/tools/stamp-meta.mjs. Do not edit by hand. -->`,
    `<title>${esc(c.name)} — Install Guide</title>`,
    `<meta name="description" content="${esc(c.description || '')}">`,
    '<meta property="og:type" content="article">',
    `<meta property="og:site_name" content="${esc(site.brand || '')}">`,
    `<meta property="og:url" content="${esc(url(c.docsUrl))}">`,
    `<meta property="og:title" content="${esc(c.name)}">`,
    `<meta property="og:description" content="${esc(c.description || '')}">`,
  ];
  // A widget thumb wins; otherwise the site's wide card keeps every embed visual.
  const image = c.thumb || site.ogImage || site.logo;
  if (image) lines.push(`<meta property="og:image" content="${esc(url(image))}">`);
  lines.push('<!-- Discord embed left rule. -->');
  lines.push(`<meta name="theme-color" content="${esc(c.accent || '#D4A843')}">`);
  if (image) lines.push('<meta name="twitter:card" content="summary_large_image">');
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
    console.error(`  ${rel}  MISSING`);
    failed++;
    continue;
  }

  const a = html.indexOf(START), b = html.indexOf(END);
  if (a < 0 || b < a) {
    console.error(`  ${rel}  no ${START} … ${END} markers — copy them from another docs shim`);
    failed++;
    continue;
  }

  // Follow the file's own line ending — autocrlf gives CRLF on some checkouts.
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  const stamped = block(c, SITE).trimStart().replace(/\n/g, eol);
  const next = html.slice(0, a) + stamped + html.slice(b + END.length);
  if (next === html) { console.log(`  ${rel}  unchanged`); continue; }
  await writeFile(path.join(ROOT, rel), next, 'utf8');
  console.log(`  ${rel}  updated`);
  changed++;
}

console.log(`${changed} file(s) changed.`);
process.exit(failed ? 1 : 0);
