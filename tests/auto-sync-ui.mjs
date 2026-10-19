import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { gitlabFixture, memoryCache } from './network-fixture.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(process.env.STARMAP_PLAYWRIGHT_PACKAGE || fileURLToPath(new URL('../../portal-desktop/package.json', import.meta.url)));
const { chromium } = require('playwright-core');
const output = path.join(project, '.npm-cache/autosync-ui'); await mkdir(output, { recursive: true });
const bundle = await build({ absWorkingDir: project, entryPoints: ['src/main.tsx'], bundle: true, outfile: 'index.js', write: false, minify: true, format: 'iife', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"', '__STARMAP_VERSION__': JSON.stringify(JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8')).version) } });
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const htmlPath = path.join(output, 'index.html');
await writeFile(htmlPath, '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + bundle.outputFiles.find(file => file.path.endsWith('.css')).text + '</style></head><body><div id="plugin-status" role="status"></div><div id="root"></div><script>' + script + '</script></body></html>');
const compiled = await build({ bundle: true, write: false, format: 'esm', platform: 'node', stdin: { contents: 'export * from "./src/models/templates";', resolveDir: project } });
const models = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const seed = models.createInitialPipelineState(); seed.demands = [models.createDemand('隔离自动同步', 'Fixture', models.blankPipeline)]; seed.selectedDemandId = seed.demands[0].id;
const server = gitlabFixture(seed, 'isolated-test', 'collaboration'); server.config.baseUrl = 'http://newgit.d5techs.com.cn'; server.config.projectId = 9001;
const browser = await chromium.launch({ headless: true, ...(process.env.STARMAP_BROWSER_PATH ? { executablePath: process.env.STARMAP_BROWSER_PATH } : {}) });
const errors = [], nativeRequests = [], caches = [], observations = [];
let phase = 'starting';
const watchdog = setTimeout(() => { console.error('UI harness timeout:', phase, 'page errors:', JSON.stringify(errors)); process.exit(1); }, 45000);
const until = async (condition, message) => { const end = Date.now() + 12000; while (!await condition()) { if (Date.now() > end) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 50)); } };
async function openClient() {
  phase = 'create context / page';
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } }), page = await context.newPage(), cache = memoryCache(); caches.push(cache);
  phase = 'bind route';
  page.on('pageerror', error => errors.push(error.message)); await page.route(/^https?:/, route => { nativeRequests.push(route.request().url()); return route.abort(); });
  phase = 'expose load'; await page.exposeFunction('fixtureLoad', () => cache.values);
  await page.exposeFunction('fixtureSave', patch => cache.setItems(patch));
  await page.exposeFunction('fixtureNetwork', async (url, init = {}) => {
    const address = new URL(url); assert.equal(address.origin, 'http://newgit.d5techs.com.cn');
    let result;
    if (address.pathname === '/api/v4/user') result = new Response(JSON.stringify({ id: new Headers(init.headers).get('Authorization')?.endsWith('fixture-A') ? 501 : 502, username: 'UI-fixture-user' }));
    else result = await server.fetch(url, init);
    return { status: result.status, headers: Object.fromEntries(result.headers), body: await result.text() };
  });
  await page.addInitScript(() => {
    window.grove = {
      loadData: () => window.fixtureLoad(), updateData: patch => window.fixtureSave(patch), onUnload: () => () => {},
      network: { fetch: async (url, init) => { const result = await window.fixtureNetwork(url, init); return new Response(init?.method === 'HEAD' ? null : result.body, { status: result.status, headers: result.headers }); } },
      being: { context: async () => ({ name: 'Fixture', connected: true }), tasks: { list: async () => ({ tasks: [], ready: true, scopeId: 'fixture', sceneId: 'fixture' }), onChange: async () => () => {} }, chat: () => { throw new Error('No messages authorized'); }, compose: () => { throw new Error('No messages authorized'); }, onDelta: () => () => {} },
      town: { query: () => { throw new Error('No real contacts authorized'); } }, ui: { notice: async () => {}, navigate: async () => {} },
    };
  });
  phase = 'navigate'; await page.goto(pathToFileURL(htmlPath).href);
  const bar = page.getByRole('region', { name: '团队联网同步', exact: true });
  phase = 'wait initial UI'; await bar.getByText(/未连接/).waitFor({ timeout: 10000 });
  assert.equal(await bar.getByRole('form', { name: 'GitLab 会话登录', exact: true }).count(), 0);
  return { page, bar, cache, context };
}
async function openAdvanced(bar) {
  const details = bar.locator('details.pipeline-network-advanced');
  if (!await details.count()) return;
  if (!await details.evaluate(element => element.open)) await details.locator('summary').click();
}
async function login(client, token) {
  await client.bar.getByRole('button', { name: '登录 / 联网设置', exact: true }).click();
  await openAdvanced(client.bar);
  await client.bar.getByLabel('GitLab 入口', { exact: true }).fill(server.config.baseUrl);
  await client.bar.getByLabel('GitLab 项目 ID', { exact: true }).fill(String(server.config.projectId));
  await client.bar.getByLabel('GitLab 目标分支', { exact: true }).fill(server.config.branch);
  await client.bar.getByLabel('联网空间标识', { exact: true }).fill('isolated-test');
  await client.bar.getByLabel('GitLab 访问令牌', { exact: true }).fill(token);
  await client.bar.getByRole('button', { name: '连接', exact: true }).click();
  await client.bar.getByText(/^已同步 · isolated-test$/).waitFor();
  assert.equal(await client.bar.getByRole('region', { name: '登录与自动同步设置', exact: true }).count(), 0);
}
try {
  const first = await openClient(), second = await openClient();
  await first.bar.getByRole('button', { name: '登录 / 联网设置', exact: true }).click();
  await openAdvanced(first.bar);
  assert.equal(await first.bar.getByLabel('GitLab 入口', { exact: true }).inputValue(), 'http://newgit.d5techs.com.cn');
  await first.bar.getByLabel('GitLab 项目 ID', { exact: true }).fill(String(server.config.projectId));
  await first.bar.getByLabel('GitLab 目标分支', { exact: true }).fill(server.config.branch);
  await first.bar.getByLabel('GitLab 入口', { exact: true }).fill('http://newgit.d5techs.com.cn.evil.invalid');
  await first.bar.getByLabel('GitLab 访问令牌', { exact: true }).fill('fixture-blocked');
  await first.bar.getByRole('button', { name: '连接', exact: true }).click();
  await first.bar.getByRole('alert').filter({ hasText: '安全阻断' }).waitFor(); assert.equal(server.calls.length, 0);
  assert.equal(await first.bar.getByLabel('GitLab 访问令牌', { exact: true }).inputValue(), '');
  await first.bar.getByLabel('GitLab 入口', { exact: true }).fill(server.config.baseUrl);
  await first.bar.getByText('公司仓走 HTTP 未加密', { exact: false }).waitFor();
  await first.bar.getByRole('button', { name: '登录 / 联网设置', exact: true }).click();
  await login(first, 'fixture-A'); await login(second, 'fixture-B');
  await first.page.getByRole('button', { name: '展开右侧详情栏', exact: true }).click(); await second.page.getByRole('button', { name: '展开右侧详情栏', exact: true }).click();
  const title = client => client.page.getByRole('textbox', { name: '任务名称', exact: true });
  await title(first).fill('A 自动同步到 B'); await until(() => server.state().demands[0].title === 'A 自动同步到 B', 'Auto upload did not complete');
  await until(async () => await title(second).inputValue() === 'A 自动同步到 B', 'Second independent browser context did not poll update');
  observations.push('两个独立浏览器上下文以模拟宿主自动上传 / 轮询收敛，无手动刷新；不是真实账号联测');
  await title(first).fill('A 本地冲突'); const remote = server.state(); remote.demands[0].title = '远端并发冲突'; server.put(remote);
  const conflict = first.page.getByRole('region', { name: '联网字段冲突', exact: true }); await conflict.waitFor(); assert.equal(server.state().demands[0].title, '远端并发冲突');
  const conflictGeometry = await conflict.boundingBox(), conflictCanvas = await first.page.locator('.pipeline-main').boundingBox();
  assert(conflictCanvas.height >= 120); assert(conflictGeometry.y + conflictGeometry.height <= conflictCanvas.y);
  assert(await conflict.getByRole('combobox').first().isVisible()); await first.page.screenshot({ path: path.join(output, 'field-conflict-1440.png') });
  for (const selection of await conflict.getByRole('combobox').all()) await selection.selectOption('local');
  await conflict.getByRole('button', { name: '应用冲突选择', exact: true }).click(); await until(() => server.state().demands[0].title === 'A 本地冲突', 'Resolved conflict did not auto upload');
  await first.bar.getByRole('button', { name: '联网设置', exact: true }).click();
  for (const viewport of [{ width: 1440, height: 960 }, { width: 1280, height: 720 }, { width: 800, height: 700 }]) {
    await first.page.setViewportSize(viewport);
    if (viewport.width === 800) {
      await first.page.getByRole('button', { name: '收起左侧星轨栏', exact: true }).click(); await first.page.getByRole('button', { name: '收起右侧详情栏', exact: true }).click();
    }
    const geometry = await first.page.evaluate(() => {
      const box = selector => { const rect = document.querySelector(selector).getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }; };
      return { viewport: { width: innerWidth, height: innerHeight }, overflow: document.documentElement.scrollWidth - innerWidth, settings: box('.pipeline-network-settings'), summary: box('.pipeline-network-summary'), canvas: box('.pipeline-main') };
    });
    assert(geometry.overflow <= 1, JSON.stringify(geometry)); assert(geometry.canvas.height >= 120, JSON.stringify(geometry)); assert(geometry.canvas.bottom <= viewport.height + 1);
    await first.bar.getByRole('button', { name: '退出账号', exact: true }).scrollIntoViewIfNeeded(); const logout = await first.bar.getByRole('button', { name: '退出账号', exact: true }).boundingBox();
    assert(logout.y >= geometry.settings.y && logout.y + logout.height <= geometry.settings.bottom + 1);
    await first.page.screenshot({ path: path.join(output, 'connected-' + viewport.width + '.png') }); observations.push(geometry);
  }
  await first.bar.getByRole('button', { name: '退出账号', exact: true }).click(); await first.bar.getByText(/未连接/).waitFor();
  assert.equal(await first.bar.getByLabel('GitLab 访问令牌', { exact: true }).inputValue(), '');
  const loginButton = await first.bar.getByRole('button', { name: '连接', exact: true }).boundingBox();
  const loginSettings = await first.page.locator('.pipeline-network-settings').boundingBox(), loginCanvas = await first.page.locator('.pipeline-main').boundingBox();
  assert(loginButton.y >= loginSettings.y && loginButton.y + loginButton.height <= loginSettings.y + loginSettings.height); assert(loginCanvas.height >= 120, JSON.stringify({ loginButton, loginSettings, loginCanvas }));
  observations.push({ login800: { button: loginButton, settings: loginSettings, canvas: loginCanvas } });
  await first.page.screenshot({ path: path.join(output, 'session-login-800.png') });
  await first.page.reload(); await first.bar.getByText(/未连接/).waitFor();
  assert(!JSON.stringify(caches.map(cache => cache.values)).includes('fixture-A')); assert(!JSON.stringify(caches.map(cache => cache.values)).includes('fixture-B')); assert(!JSON.stringify(caches.map(cache => cache.values)).includes('fixture-blocked'));
  assert.equal(nativeRequests.length, 0); assert.deepEqual(errors, []);
  observations.push('恶意相似 HTTP 域名零请求；默认预设公司入口、显式填写后公司 HTTP 直达会话登录，未加密提示可见，无重复 HTTP 确认；密码及时清空、退出 / 重载未登录、缓存无模拟令牌、零原生 HTTP(S)、零消息调用');
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ mode: 'real Chromium; two isolated contexts; mocked Grove/GitLab; no actual GitLab or messages', observations }, null, 2));
  console.log(JSON.stringify({ passed: true, artifacts: output, observations }, null, 2));
} finally { clearTimeout(watchdog); await browser.close(); }
