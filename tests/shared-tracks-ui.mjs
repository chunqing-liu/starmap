import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { gitlabFixture, memoryCache } from './network-fixture.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(process.env.STARMAP_PLAYWRIGHT_PACKAGE || fileURLToPath(new URL('../../portal-desktop-main/package.json', import.meta.url)));
const { chromium } = require('playwright-core');
const output = path.join(project, '.npm-cache/shared-tracks-ui'); await mkdir(output, { recursive: true });
const bundle = await build({ absWorkingDir: project, entryPoints: ['src/main.tsx'], bundle: true, outfile: 'index.js', write: false, format: 'iife', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"', '__STARMAP_VERSION__': JSON.stringify(JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8')).version) } });
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const htmlPath = path.join(output, 'index.html');
await writeFile(htmlPath, '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + bundle.outputFiles.find(file => file.path.endsWith('.css')).text + '</style></head><body><div id="plugin-status" role="status"></div><div id="root"></div><script>' + script + '</script></body></html>');
const compiled = await build({ bundle: true, write: false, format: 'esm', platform: 'node', stdin: { contents: 'export * from "./src/models/templates"; export * from "./src/gitlab-client";', resolveDir: project } });
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const state = title => { const value = api.createInitialPipelineState(); value.demands = [api.createDemand(title, 'UI Test', api.blankPipeline)]; value.selectedDemandId = value.demands[0].id; return value; };
const server = gitlabFixture(null, 'uncreated', 'collaboration'), cache = memoryCache();
const remote = new api.GitLabClient(server.fetch, async () => 'synthetic-ui-session-only', server.config);
let directoryDenied = false;
const browser = await chromium.launch({ headless: true, timeout: 15000, ...(process.env.STARMAP_BROWSER_PATH ? { executablePath: process.env.STARMAP_BROWSER_PATH } : {}) });
const errors = [], nativeRequests = [], observations = [];
const until = async (condition, message) => { const end = Date.now() + 12000; while (!await condition()) { if (Date.now() > end) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 50)); } };
let phase = 'starting';
const watchdog = setTimeout(() => {
  console.error('Shared tracks UI timeout:', phase);
  void browser.close().finally(() => process.exit(1));
  setTimeout(() => process.exit(1), 2000).unref();
}, 90000);
async function openAdvanced(bar) {
  const details = bar.locator('details.pipeline-network-advanced');
  if (!await details.count()) return;
  if (!await details.evaluate(element => element.open)) await details.locator('summary').click();
}
try {
  phase = 'create isolated context';
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  context.setDefaultTimeout(10000); phase = 'create isolated page';
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:/, route => { nativeRequests.push(route.request().url()); return route.abort(); });
  await page.exposeFunction('fixtureLoad', () => cache.values);
  await page.exposeFunction('fixtureSave', patch => cache.setItems(patch));
  await page.exposeFunction('fixtureNetwork', async (url, init) => {
    assert.equal(new URL(url).origin, server.config.baseUrl);
    const result = directoryDenied && new URL(url).pathname.endsWith('/repository/tree') ? new Response('{}', { status: 403 }) : await server.fetch(url, init);
    return { status: result.status, headers: Object.fromEntries(result.headers), body: await result.text() };
  });
  await page.addInitScript(() => {
    window.grove = {
      loadData: () => window.fixtureLoad(), updateData: patch => window.fixtureSave(patch), onUnload: () => () => {},
      network: { fetch: async (url, init) => { const result = await window.fixtureNetwork(url, init); return new Response(init?.method === 'HEAD' ? null : result.body, { status: result.status, headers: result.headers }); } },
      being: { context: async () => ({ name: 'UI Test', connected: true }), tasks: { list: async () => ({ tasks: [], ready: true, scopeId: 'unit', sceneId: 'unit' }), onChange: async () => () => {} }, chat: () => { throw new Error('Messages are not authorized'); }, compose: () => { throw new Error('Messages are not authorized'); }, onDelta: () => () => {} },
      town: { query: () => { throw new Error('Real member lookup is not authorized'); } }, ui: { notice: async () => {}, navigate: async () => {} },
    };
  });
  phase = 'login / empty directory'; await page.goto(pathToFileURL(htmlPath).href);
  const bar = page.getByRole('region', { name: '团队联网同步', exact: true });
  await bar.getByRole('button', { name: '登录 / 联网设置', exact: true }).click();
  await openAdvanced(bar);
  await bar.getByLabel('GitLab 入口', { exact: true }).fill(server.config.baseUrl);
  await bar.getByLabel('GitLab 项目 ID', { exact: true }).fill(String(server.config.projectId));
  await bar.getByLabel('GitLab 目标分支', { exact: true }).fill(server.config.branch);
  await bar.getByLabel('联网空间标识', { exact: true }).fill('uncreated');
  await bar.getByLabel('GitLab 访问令牌', { exact: true }).fill('synthetic-ui-session-only');
  await bar.getByRole('button', { name: '连接', exact: true }).click();
  const directory = bar.getByRole('region', { name: '共享空间目录', exact: true });
  await directory.getByText(/此分支暂无共享空间/).waitFor();
  assert(await directory.getByLabel('选择共享空间', { exact: true }).isDisabled());
  assert(await bar.getByRole('button', { name: '刷新团队星轨', exact: true }).isVisible());
  assert.equal(await bar.getByRole('region', { name: '登录与自动同步设置', exact: true }).count(), 0);
  assert.equal(server.commits, 0); observations.push('空目录有说明、不自动创建空间，刷新星轨无需展开设置');

  phase = 'share non-secret target';
  await bar.getByRole('button', { name: '分享团队空间信息', exact: true }).click();
  const sharedText = await bar.getByLabel('团队空间连接信息（分享）', { exact: true }).inputValue();
  const shared = JSON.parse(sharedText);
  assert.deepEqual(Object.keys(shared).sort(), ['baseUrl', 'branch', 'kind', 'projectId', 'space', 'version']);
  assert(!sharedText.includes('synthetic-ui-session-only'));
  await bar.getByRole('button', { name: '收起连接信息', exact: true }).click();
  observations.push('已连接目标可生成不含令牌/账号/正文的连接信息，内部地址提示仅供获授权成员使用');

  phase = 'permission error / retry'; directoryDenied = true;
  await directory.getByRole('button', { name: '刷新空间列表', exact: true }).click();
  await directory.getByRole('alert').getByText(/GitLab 拒绝访问或写入/).waitFor();
  assert.equal(await directory.getByText(/此分支暂无共享空间/).count(), 0);
  directoryDenied = false; await directory.getByRole('button', { name: '刷新空间列表', exact: true }).click();
  await directory.getByText(/此分支暂无共享空间/).waitFor();
  assert.equal(await directory.getByRole('alert').count(), 0);
  observations.push('403 不伪装空目录，重试可恢复，不修改当前空间');

  phase = 'select shared directory';
  await remote.save('team-alpha', state('共享星轨 Alpha'), null, 'UI Test');
  await remote.save('team-beta', state('共享星轨 Beta'), null, 'UI Test');
  await directory.getByRole('button', { name: '刷新空间列表', exact: true }).click();
  await until(async () => await directory.getByLabel('选择共享空间').locator('option').count() === 3, 'Directory did not list new spaces');
  await directory.getByLabel('选择共享空间').selectOption('team-alpha');
  await page.locator('.pipeline-demand-item').filter({ hasText: '共享星轨 Alpha' }).waitFor();
  assert.equal(await directory.getByLabel('选择共享空间').inputValue(), 'team-alpha');
  assert.equal(server.commits, 2); observations.push('直接选择同一项目/分支下共享空间并加载星轨，切换只读');

  phase = 'empty search / create track';
  const search = page.getByRole('searchbox', { name: '搜索星轨', exact: true });
  await search.fill('不存在的星轨'); await page.getByText('没有匹配的星轨。', { exact: false }).waitFor();
  await page.getByRole('button', { name: '清除星轨筛选', exact: true }).click(); assert.equal(await search.inputValue(), '');
  await search.fill('仍不存在'); await page.getByLabel('按状态筛选', { exact: true }).selectOption({ index: 2 });
  await page.getByRole('button', { name: '+ 新建星轨', exact: true }).click();
  assert.equal(await search.inputValue(), ''); assert.equal(await page.getByLabel('按状态筛选', { exact: true }).inputValue(), 'all');
  const created = page.locator('.pipeline-demand-item').filter({ hasText: '新建星轨' }); await created.waitFor();
  assert.equal(await created.getAttribute('aria-pressed'), 'true');
  await until(async () => (await remote.load('team-alpha')).state.demands.length === 2, 'New track did not reach the code fixture');
  assert.equal(server.commits, 3); observations.push('新建自动清除搜索/状态过滤，立即可见且选中，沿用现有自动上传');

  phase = 'refresh discovers track';
  const changed = await remote.load('team-alpha'); const another = api.createDemand('代码测试远端新增星轨', 'UI Test', api.blankPipeline); changed.state.demands.push(another);
  await remote.save('team-alpha', changed.state, changed.rev, 'UI Test');
  await bar.getByRole('button', { name: '刷新团队星轨', exact: true }).click();
  await page.locator('.pipeline-demand-item').filter({ hasText: another.title }).waitFor();
  await page.locator('.pipeline-demand-item').filter({ hasText: another.title }).click();
  assert.equal(await page.getByRole('textbox', { name: '任务名称', exact: true }).inputValue(), another.title);
  assert.equal(server.commits, 4); observations.push('常驻刷新入口发现新增星轨，可从星轨列表选择；刷新与选择不提交');

  phase = 'directory refresh / space isolation';
  await remote.save('team-gamma', state('共享星轨 Gamma'), null, 'UI Test');
  await directory.getByRole('button', { name: '刷新空间列表', exact: true }).click();
  await until(async () => await directory.getByLabel('选择共享空间').locator('option').count() === 3, 'Refreshed directory did not discover another space');
  await directory.getByLabel('选择共享空间').selectOption('team-beta');
  await page.locator('.pipeline-demand-item').filter({ hasText: '共享星轨 Beta' }).waitFor();
  assert.equal(await page.locator('.pipeline-demand-item').count(), 1);
  await directory.getByLabel('选择共享空间').selectOption('team-alpha');
  await page.locator('.pipeline-demand-item').filter({ hasText: another.title }).waitFor();
  assert.equal(await page.locator('.pipeline-demand-item').count(), 3);
  observations.push('刷新目录发现新增空间，往返切换不串空间内容');

  phase = 'responsive layout';
  for (const viewport of [{ width: 1440, height: 960 }, { width: 800, height: 700 }]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, canvasHeight: document.querySelector('.pipeline-main').getBoundingClientRect().height }));
    assert(geometry.overflow <= 1, JSON.stringify(geometry)); assert(geometry.canvasHeight >= 120, JSON.stringify(geometry));
    await page.screenshot({ path: path.join(output, 'shared-tracks-' + viewport.width + '.png') });
  }
  phase = 'receiver validate / preview / confirm';
  let receiverNetworkCalls = 0;
  const receiver = await context.newPage();
  receiver.setDefaultTimeout(10000);
  receiver.on('pageerror', error => errors.push(error.message));
  await receiver.route(/^https?:/, route => { receiverNetworkCalls++; return route.abort(); });
  await receiver.addInitScript(() => {
    window.grove = {
      loadData: () => ({}), updateData: () => Promise.resolve(), onUnload: () => () => {},
      network: { fetch: async () => { throw new Error('Receiver network is not authorized in local UI test'); } },
      being: { context: async () => ({ name: 'UI Test', connected: true }), tasks: { list: async () => ({ tasks: [], ready: true, scopeId: 'unit', sceneId: 'unit' }), onChange: async () => () => {} }, chat: () => { throw new Error('Messages are not authorized'); }, compose: () => { throw new Error('Messages are not authorized'); }, onDelta: () => () => {} },
      town: { query: () => { throw new Error('Real member lookup is not authorized'); } }, ui: { notice: async () => {}, navigate: async () => {} },
    };
  });
  await receiver.goto(pathToFileURL(htmlPath).href);
  const receiverBar = receiver.getByRole('region', { name: '团队联网同步', exact: true });
  const draftBefore = await receiver.locator('.pipeline-demand-item').first().innerText();
  await receiverBar.getByRole('button', { name: '登录 / 联网设置', exact: true }).click();
  await openAdvanced(receiverBar);
  await receiverBar.getByRole('button', { name: '加入别的团队空间', exact: true }).click();
  const joinInput = receiverBar.getByLabel('团队空间连接信息', { exact: true });
  await joinInput.fill(JSON.stringify({ ...shared, token: 'must-not-be-accepted' }));
  await receiverBar.getByRole('button', { name: '校验并预览', exact: true }).click();
  await receiverBar.getByRole('alert').getByText(/不允许的字段/).waitFor();
  assert.equal(await receiverBar.getByLabel('GitLab 入口', { exact: true }).inputValue(), 'http://newgit.d5techs.com.cn');
  await joinInput.fill(sharedText);
  await receiverBar.getByRole('button', { name: '校验并预览', exact: true }).click();
  await receiverBar.getByRole('region', { name: '加入目标预览', exact: true }).waitFor();
  await receiverBar.getByRole('button', { name: '确认并用本人账号登录', exact: true }).click();
  assert.equal(await receiverBar.getByLabel('GitLab 入口', { exact: true }).inputValue(), shared.baseUrl);
  assert.equal(await receiverBar.getByLabel('GitLab 项目 ID', { exact: true }).inputValue(), String(shared.projectId));
  assert.equal(await receiverBar.getByLabel('GitLab 目标分支', { exact: true }).inputValue(), shared.branch);
  assert.equal(await receiverBar.getByLabel('联网空间标识', { exact: true }).inputValue(), shared.space);
  assert.equal(await receiver.locator('.pipeline-demand-item').first().innerText(), draftBefore);
  assert.equal(receiverNetworkCalls, 0); assert.equal(server.commits, 5);
  observations.push('隔离接收端拒绝带令牌字段，校验通过后预览并确认目标；仅填充本人登录目标，原本机草稿不变（同账号合成 UI，不代表不同成员验收）');
  await receiver.close();

  assert.equal(nativeRequests.length, 0); assert.deepEqual(errors, []);
  assert(!JSON.stringify(cache.values).includes('synthetic-ui-session-only'));
  assert(server.calls.every(call => call.ref !== 'master' && !call.pathname.endsWith('/master')));
  const result = { passed: true, mode: 'code/UI tests only; real headless Chromium; synthetic host/data; zero real GitLab requests; not a multi-member acceptance test', observations };
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error('Shared tracks UI failed at:', phase); throw error; }
finally { clearTimeout(watchdog); await browser.close(); }
