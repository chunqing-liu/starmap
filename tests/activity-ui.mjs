import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const project = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(process.env.STARMAP_PLAYWRIGHT_PACKAGE || fileURLToPath(new URL('../../portal-desktop/package.json', import.meta.url)));
const { chromium } = require('playwright-core');
const output = path.join(project, '.npm-cache/activity-ui');
await mkdir(output, { recursive: true });
const bundle = await build({ absWorkingDir: project, entryPoints: ['src/main.tsx'], bundle: true, outfile: 'index.js', write: false, minify: true, format: 'iife', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"', '__STARMAP_VERSION__': JSON.stringify(JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8')).version) } });
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const style = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const htmlPath = path.join(output, 'index.html');
await writeFile(htmlPath, '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + style + '</style></head><body><div id="plugin-status" role="status"></div><div id="root"></div><script>' + script + '</script></body></html>');
const compiled = await build({ bundle: true, write: false, format: 'esm', platform: 'node', stdin: { contents: 'export * from "./src/models/templates";', resolveDir: project } });
const models = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const state = models.createInitialPipelineState();
const demand = models.createDemand('隔离 UI 演练', 'test', models.blankPipeline);
demand.customStations = [{ id: 'stage', kind: 'station', title: '并行阶段', subtitle: '隔离测试', nodeIds: ['first', 'second', 'third', 'gate'] }];
demand.customNodes = [
  { id: 'first', title: '新节点', status: 'pending', responsibleBeingIds: ['t_alice'] },
  { id: 'second', title: '旧运行节点', status: 'running', responsibleBeingIds: ['t_bob'] },
  { id: 'third', title: '并行等待负责人确认的很长节点名称用于验证列表不会遮挡催办按钮', status: 'waiting_human', responsibleBeingIds: ['t_bob'] },
  { id: 'gate', title: '不可删除的闸口', status: 'pending', kind: 'gate', locked: true },
].map(node => ({ kind: 'node', owner: '流程角色', owner_group: 'test', description: '测试描述与完成证据', trigger: ['人工'], stationId: 'stage', ...node }));
demand.positions = { stage: { x: 70, y: 30 }, first: { x: 110, y: 100 }, second: { x: 110, y: 270 }, third: { x: 110, y: 440 }, gate: { x: 110, y: 610 } };
state.demands = [demand]; state.selectedDemandId = demand.id;
const browser = await chromium.launch({ headless: true, ...(process.env.STARMAP_BROWSER_PATH ? { executablePath: process.env.STARMAP_BROWSER_PATH } : {}) });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const pageErrors = []; const requests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
  await page.addInitScript(({ state, storageKey }) => {
    const saved = localStorage.getItem('activity-ui-fixture');
    const stored = saved ? JSON.parse(saved) : { [storageKey]: JSON.stringify(state) };
    window.testData = stored; window.testCalls = [];
    window.grove = {
      loadData: async () => stored,
      updateData: async patch => { Object.assign(stored, patch); localStorage.setItem('activity-ui-fixture', JSON.stringify(stored)); },
      town: { query: async query => { window.testCalls.push({ type: 'directory', kind: query.kind }); return { ok: true, data: { entries: [{ town_id: 't_alice', display_name: 'Alice' }, { town_id: 't_bob', display_name: 'Bob' }], count: 2 } }; } },
      being: { context: async () => ({ connected: true, name: 'Fixture', sceneId: 'test', sceneLabel: '隔离 UI' }), tasks: { list: async () => ({ tasks: [], ready: true, scopeId: 'test', sceneId: 'test' }), onChange: async () => () => {} }, chat: async () => { window.testCalls.push({ type: 'forbidden-message' }); throw new Error('禁止发送'); }, compose: async () => { window.testCalls.push({ type: 'forbidden-compose' }); throw new Error('禁止草稿'); }, onDelta: () => () => {} },
      network: { fetch: async () => { window.testCalls.push({ type: 'forbidden-network' }); throw new Error('禁止联网写入'); } },
      ui: { navigate: async () => {}, notice: async () => {} },
    };
  }, { state, storageKey: models.PIPELINE_STORAGE_KEY });
  await page.goto(pathToFileURL(htmlPath).href);
  const overview = page.getByRole('region', { name: '当前节点与阶段耗时' });
  await overview.getByText('当前节点 2', { exact: true }).waitFor();
  await overview.getByRole('button', { name: '旧运行节点 · 流程角色', exact: true }).click();
  const timing = page.getByRole('region', { name: '节点真实时间' });
  assert.equal(await timing.locator('dd').allTextContents().then(values => values.join('/')), '未记录/未记录/未记录');
  const selectNode = async id => { await page.locator('.react-flow__node-item[data-id="' + id + '"]').click(); };
  const nodeStatus = () => page.locator('.pipeline-detail-meta label').filter({ hasText: '状态' }).locator('select');
  const readState = () => page.evaluate(key => JSON.parse(window.testData[key]), models.PIPELINE_STORAGE_KEY);
  await selectNode('first');
  const before = Date.now(); await nodeStatus().selectOption('running');
  await overview.getByText('当前节点 3', { exact: true }).waitFor();
  await page.waitForFunction(key => JSON.parse(window.testData[key]).demands[0].activityEvents?.length === 1, models.PIPELINE_STORAGE_KEY);
  let current = await readState(); const entered = current.demands[0].activityEvents.at(-1).at;
  assert(Date.parse(entered) >= before && Date.parse(entered) <= Date.now());
  await nodeStatus().selectOption('waiting_human'); await nodeStatus().selectOption('done');
  await page.waitForFunction(key => JSON.parse(window.testData[key]).demands[0].activityEvents?.length === 3, models.PIPELINE_STORAGE_KEY);
  current = await readState(); assert.equal(current.demands[0].activityEvents.length, 3);
  assert.equal(await timing.locator('dd').nth(0).textContent(), await page.evaluate(value => new Date(value).toLocaleString(), entered));
  await page.locator('.pipeline-detail-identity input').click(); await page.locator('.pipeline-main').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('Control+z');
  await page.waitForFunction(key => JSON.parse(window.testData[key]).demands[0].activityEvents.length === 4, models.PIPELINE_STORAGE_KEY);
  await overview.getByRole('button', { name: '新节点 · 流程角色', exact: true }).click();
  const owners = page.getByRole('textbox', { name: '负责 Being 地址', exact: true });
  await owners.fill('t_alice, t_bob'); await owners.press('End'); await owners.type(','); assert((await owners.inputValue()).endsWith(','));
  await overview.getByRole('button', { name: '催办当前负责 Being（仅模拟）', exact: true }).click();
  const reminder = page.getByRole('region', { name: '模拟催办面板' });
  assert(await reminder.getByRole('button', { name: '确认模拟催办', exact: true }).isDisabled());
  await reminder.getByRole('button', { name: '只读核验通讯录地址', exact: true }).click();
  await reminder.getByText('Bob · t_bob · 3 个当前节点', { exact: true }).waitFor();
  await reminder.getByRole('button', { name: '确认模拟催办', exact: true }).click();
  await reminder.getByLabel('模拟送达结果').getByText('t_alice：模拟送达（非真实消息）', { exact: true }).waitFor();
  assert.equal(await reminder.getByLabel('模拟送达结果').locator('li').count(), 2);
  await reminder.getByRole('button', { name: '确认模拟催办', exact: true }).click(); await reminder.getByText(/五分钟内已模拟催办/).waitFor();
  results.push('真实浏览器操作生成当下时间；旧数据未记录；等待与并行节点正确；撤销追加记录；多负责人模拟逐人回执与防重');
  await page.getByText('阶段耗时（并行区间不重复累加）', { exact: true }).click();
  for (const viewport of [{ width: 1440, height: 960 }, { width: 1280, height: 720 }, { width: 800, height: 700 }]) {
    await page.setViewportSize(viewport);
    if (viewport.width === 800) {
      await page.getByRole('button', { name: '收起左侧星轨栏', exact: true }).click();
      await page.getByRole('button', { name: '收起右侧详情栏', exact: true }).click();
    }
    await reminder.getByRole('button', { name: '确认模拟催办', exact: true }).scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => {
      const box = selector => { const element = document.querySelector(selector); const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right }; };
      return { viewport: { width: innerWidth, height: innerHeight }, overflow: document.documentElement.scrollWidth - innerWidth, overview: box('.activity-overview'), reminder: box('.reminder-panel'), canvas: box('.pipeline-main'), toolbar: box('.pipeline-page-toolbar') };
    });
    assert(geometry.overflow <= 1, JSON.stringify(geometry)); assert(geometry.overview.right <= viewport.width + 1);
    assert(geometry.canvas.height >= 120, JSON.stringify(geometry)); assert(geometry.canvas.y >= geometry.overview.bottom - 1, JSON.stringify(geometry));
    assert(geometry.canvas.bottom <= viewport.height + 1, JSON.stringify(geometry));
    const button = reminder.getByRole('button', { name: '确认模拟催办', exact: true });
    assert(await button.isVisible()); const bounds = await button.boundingBox();
    assert(bounds.y >= geometry.reminder.y && bounds.y + bounds.height <= geometry.reminder.bottom + 1);
    await page.screenshot({ path: path.join(output, 'activity-' + viewport.width + '.png') }); results.push(geometry);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button', { name: '展开右侧详情栏', exact: true }).click();
  await overview.getByRole('button', { name: '催办当前负责 Being（仅模拟）', exact: true }).click();
  await selectNode('gate'); await page.getByText('更多信息', { exact: true }).click();
  assert(await page.getByRole('button', { name: '闸口或结构规则保护，不可删除', exact: true }).isDisabled());
  await nodeStatus().selectOption('running'); await overview.getByText('当前节点 4', { exact: true }).waitFor();
  await page.waitForFunction(key => JSON.parse(window.testData[key]).demands[0].nodeStates.gate === 'running', models.PIPELINE_STORAGE_KEY);
  assert.equal((await readState()).demands[0].nodeStates.gate, 'running');
  assert.deepEqual(await page.evaluate(() => window.testCalls), [{ type: 'directory', kind: 'contacts' }]);
  assert.equal(requests.length, 0); assert.deepEqual(pageErrors, []);
  await page.reload(); await overview.getByText('当前节点 4', { exact: true }).waitFor();
  assert.equal((await readState()).demands[0].activityEvents.length, 5);
  results.push('闸口不能删除但可推进；重载保留事实记录；消息/草稿/HTTP 调用均为零');
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ mode: 'real Chromium + mocked host and contacts; no actual messages or GitLab', results }, null, 2));
  console.log(JSON.stringify({ passed: true, artifacts: output, results }, null, 2));
} finally { await browser.close(); }
