import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(process.env.PORTAL_OFFICE_WORKSPACE || '.');
const cdpUrl = 'http://127.0.0.1:9225';
try { await fetch(cdpUrl + '/json/version'); throw new Error('9225 is occupied; stop only your own validation instance first'); }
catch (error) { if (!String(error).includes('fetch failed')) throw error; }
const temporaryRoot = path.join(root, '.p6-run');
await mkdir(temporaryRoot, { recursive: true });
const directory = await mkdtemp(path.join(temporaryRoot, 'production-'));
const distribution = path.join(directory, 'desktop');
await cp(path.join(root, 'node_modules/electron/dist'), distribution, { recursive: true });
const appRoot = path.join(distribution, 'resources/app');
await mkdir(path.join(appRoot, '.vite/build'), { recursive: true });
await cp(path.join(root, '.vite/renderer/main_window'), path.join(appRoot, '.vite/renderer/main_window'), { recursive: true });
await cp(path.join(root, '.vite/build/preload.js'), path.join(appRoot, '.vite/build/preload.js'));
await cp(path.join(root, 'resources/branding'), path.join(distribution, 'resources/branding'), { recursive: true });
await writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'portal-desktop', version: '0.1.5', main: '.vite/build/main.js' }));
await build({ entryPoints: ['desktop/main/main.ts'], outfile: path.join(appRoot, '.vite/build/main.js'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], plugins: [{ name: 'raw', setup(builder) { builder.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' })); builder.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await readFile(args.path.replace(/\?raw$/, ''), 'utf8'), loader: 'text' })); } }], define: { MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined', MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'), PORTAL_DESKTOP_BUILD: JSON.stringify('office-p1-production-smoke'), PORTAL_DESKTOP_UPDATE_REPOSITORY: JSON.stringify('d5z/portal-desktop') } });
const executable = path.join(distribution, process.platform === 'win32' ? 'Portal.exe' : 'electron');
if (process.platform === 'win32') await rename(path.join(distribution, 'electron.exe'), executable);
const child = spawn(executable, ['--remote-debugging-port=9225', '--in-process-gpu', '--no-sandbox'], { cwd: appRoot, env: { ...process.env, PORTAL_DESKTOP_USER_DATA: path.join(directory, 'profile') }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
let browser, page;
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { await fetch(cdpUrl + '/json/version'); break; } catch {}
    if (child.exitCode !== null) throw new Error('Production app exited: ' + output);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  browser = await chromium.connectOverCDP(cdpUrl);
  for (let attempt = 0; attempt < 80; attempt++) {
    page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('beings://desktop'));
    if (page) break;
    if (child.exitCode !== null) throw new Error('Production app exited before renderer: ' + output);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(page, 'production renderer did not open: ' + output);
  assert.equal(page.url(), 'beings://desktop/');
  const session = await browser.contexts()[0].newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.reload();
  await page.waitForTimeout(1000);
  assert.notEqual(await page.locator('body').innerText(), 'Not found', 'production protocol must serve the renderer');
  await page.locator('#options-home button').filter({ hasText: '小镇' }).evaluate(button => button.click());
  await page.locator('.place-switcher button').filter({ hasText: '星图' }).click();
  const standalone = page.getByRole('button', { name: '打开独立协作舱' });
  if (await standalone.isVisible()) await standalone.click();
  await page.waitForFunction(() => document.querySelector('.office-scene canvas'));
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.office-scene canvas').count(), 1);
  assert.equal(await page.locator('.office-people [role=status]').count(), 0);
  assert.equal(errors.length, 0, errors.join(' | '));
  assert(!requests.some(url => /\/characters\/|\/assets\/office\//.test(url)), 'must not fetch upstream image paths');
  const license = await page.evaluate(async () => (await fetch('./PIXOFFICE-LICENSE.txt')).text());
  assert(license.includes('MIT License'));
  await mkdir('test-results/office', { recursive: true });
  await page.screenshot({ path: 'test-results/office/production.png' });
  console.log('PASS production beings://desktop/ + original CSP + all network blocked + one Pixi canvas + bundled MIT license');
  console.log('Production fixture: ' + directory);
  await writeFile('test-results/office/production.json', JSON.stringify({ url: page.url(), errors, upstreamAssetRequests: requests.filter(url => /\/characters\/|\/assets\/office\//.test(url)), fixture: directory }, null, 2));
  for (const script of ['office-p4-ui.mjs', 'office-p5-ui.mjs', 'office-p6-ui.mjs']) await new Promise((resolve, reject) => {
    const validation = spawn(process.execPath, [path.join(root, 'tests', script)], { cwd: root, env: { ...process.env, OFFICE_CDP_URL: cdpUrl }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    validation.stdout.pipe(process.stdout); validation.stderr.pipe(process.stderr);
    const timeout = setTimeout(() => { validation.kill(); reject(new Error(script + ' timed out')); }, 150000);
    validation.once('error', error => { clearTimeout(timeout); reject(error); });
    validation.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(script + ' failed: ' + code)); });
  });
} finally {
  if (page && child.exitCode === null) await page.evaluate(() => window.beings.quit()).catch(() => {});
  await browser?.close();
  if (child.exitCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
  if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
  const relative = path.relative(temporaryRoot, directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unexpected production cleanup target');
  await rm(directory, { recursive: true, force: true });
}
