import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { t as list } from 'tar';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('dist/desktop.plugin.json', root), 'utf8'));
const metadata = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
assert.equal(manifest.id, 'community.pipeline', 'Keep the installed plugin identity and user data');
assert.equal(manifest.apiVersion, 1);
assert.equal(manifest.version, metadata.version);
assert.equal(manifest.entry, 'index.html');
const html = await readFile(new URL('dist/index.html', root), 'utf8');
assert(Buffer.byteLength(html) < 8 * 1024 * 1024, 'HTML must fit the desktop loader limit');
assert(html.includes('<div id="root"></div>') && html.includes('<script>'));
assert(!/<script[^>]+src=|<link[^>]+href=/i.test(html), 'Bundle scripts and styles into the standalone document');
const bundle = await readFile(new URL('dist/desktop-plugin.tar.gz', root));
assert.equal((await readFile(new URL('dist/desktop-plugin.sha256', root), 'utf8')).trim(), `${createHash('sha256').update(bundle).digest('hex')}  desktop-plugin.tar.gz`);
const files = new Map();
const parser = list({ onReadEntry(entry) {
  assert.equal(entry.type, 'File');
  assert(!entry.path.includes('/') && !entry.path.includes('\\') && !files.has(entry.path), 'Only unique root-level files are allowed');
  const chunks = []; files.set(entry.path, chunks);
  entry.on('data', chunk => chunks.push(chunk));
} });
await new Promise((resolve, reject) => { parser.on('end', resolve); parser.on('error', reject); parser.end(bundle); });
assert.deepEqual([...files.keys()].sort(), ['LICENSE', 'PLUGIN_NOTICES.md', 'README.md', 'THIRD_PARTY_NOTICES', 'desktop.plugin.json', 'index.html'].sort());
for (const [name, chunks] of files) assert(Buffer.concat(chunks).equals(await readFile(new URL(`dist/${name}`, root))), `Archive content differs: ${name}`);
console.log(`PASS: ${manifest.name} v${manifest.version}; self-contained HTML, package contents and checksum verified.`);
