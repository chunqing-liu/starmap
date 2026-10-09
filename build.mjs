import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { c as archive } from 'tar';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const directory = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(directory, 'dist');
const manifest = JSON.parse(await readFile(path.join(directory, 'desktop.plugin.json'), 'utf8'));
const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
if (manifest.version !== metadata.version) throw new Error('package.json 与插件清单版本不一致。');
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${manifest.version}`) throw new Error('发布 tag 必须是 v' + manifest.version);
await mkdir(output, { recursive: true });
const result = await build({ absWorkingDir: directory, entryPoints: ['src/main.tsx'], bundle: true,
  outfile: 'index.js', write: false, minify: true, format: 'iife', target: 'chrome120',
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'inline' });
const js = result.outputFiles.find(f => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const css = result.outputFiles.find(f => f.path.endsWith('.css'))?.text || '';
const license = await readFile(path.join(directory, 'LICENSE'), 'utf8');
await writeFile(path.join(output, 'index.html'), `<!doctype html><!-- Pipeline adapted from chunqing-liu/portal-desktop, commit 2f84fd6fc9d4b00a87a1c13a4e8871a42ca5225c.\n${license}\n--><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>星图流程看板</title><style>${css}</style></head><body><div id="plugin-status" role="status">正在读取看板…</div><div id="root"></div><script>${js}</script></body></html>`);
const files = ['desktop.plugin.json', 'LICENSE', 'README.md', 'PLUGIN_NOTICES.md', 'THIRD_PARTY_NOTICES'];
for (const file of files) await copyFile(path.join(directory, file), path.join(output, file));
await archive({ cwd: output, gzip: true, portable: true, mtime: new Date('2000-01-01T00:00:00Z'), file: path.join(output, 'desktop-plugin.tar.gz') }, [...files, 'index.html']);
const digest = createHash('sha256').update(await readFile(path.join(output, 'desktop-plugin.tar.gz'))).digest('hex');
await writeFile(path.join(output, 'desktop-plugin.sha256'), `${digest}  desktop-plugin.tar.gz\n`);
console.log(`Plugin built: ${output}`);
