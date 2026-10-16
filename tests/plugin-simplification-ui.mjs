import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const project = fileURLToPath(new URL('../', import.meta.url));
const compiled = await build({
  absWorkingDir: project, bundle: true, write: false, format: 'esm', platform: 'node',
  stdin: { contents: 'export * from "./src/models/templates"; export * from "./src/models/schema";', resolveDir: project },
});
const models = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const results = [];
const record = name => { results.push(name); console.log(`PASS: ${name}`); };
const key = models.PIPELINE_STORAGE_KEY;
assert.equal(key, 'beings:star-map:v4');
assert.equal(models.NODE_STATUSES.length, 8);
assert.equal(models.DEMAND_STATUSES.length, 9);
const existing = models.createInitialPipelineState();
existing.demands = models.DEMAND_STATUSES.map((status, index) => ({
  ...structuredClone(models.defaultDemand), id: `existing-${index}`, status,
  nodeStates: Object.fromEntries(models.NODE_STATUSES.map((nodeStatus, nodeIndex) => [`N${nodeIndex}`, nodeStatus])),
}));
existing.selectedDemandId = existing.demands[0].id;
const normalized = models.sanitizePipelineState(existing);
assert.deepEqual(normalized.demands.map(demand => demand.status), [...models.DEMAND_STATUSES]);
assert.deepEqual(normalized.demands[0].nodeStates, existing.demands[0].nodeStates);
assert.equal(normalized.schemaVersion, existing.schemaVersion);
const light = models.lightPipeline;
assert.deepEqual(light.stations.map(station => station.title), ['待办', '进行中', '完成']);
assert.equal(light.nodes.filter(node => node.kind === 'gate').length, 1);
assert(!light.nodes.find(node => node.kind === 'gate').locked);
assert.equal(models.getPipelineFlow(light.id), light);
assert.equal(models.createDemand('空白星轨').workflowId, models.blankPipeline.id);
record('既有八态/九态与 v4 数据兼容；轻流程已注册，空白新建默认不变');

const browser = await chromium.launch({ headless: true, ...(process.env.STARMAP_BROWSER_PATH ? { executablePath: process.env.STARMAP_BROWSER_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ storageKey, initial }) => {
    const stored = { [storageKey]: JSON.stringify(initial), 'pipeline:assist-instruction': '旧协作提示：先核验任务' };
    window.testData = stored;
    window.testCalls = [];
    window.grove = {
      view: 'board', command: 'open-board', loadData: async () => stored,
      updateData: async patch => Object.assign(stored, patch),
      being: {
        context: async () => ({ connected: true, name: 'Being', sceneLabel: '回归场景' }),
        onDelta: () => () => {},
        compose: async message => { window.testCalls.push({ type: 'compose', message }); return { inserted: true }; },
        chat: async message => { window.testCalls.push({ type: 'chat', message }); return { status: 'accepted' }; },
        tasks: { list: async () => ({ ready: true, scopeId: 'test-scope', sceneId: 'test-scene', tasks: [{ id: 'test-task', status: 'running' }] }), onChange: async () => () => {} },
      },
      ui: { navigate: async location => { window.testCalls.push({ type: 'navigate', location }); } },
    };
  }, { storageKey: key, initial: models.createInitialPipelineState() });
  await page.goto(process.env.STARMAP_UI_HTML_PATH ? pathToFileURL(process.env.STARMAP_UI_HTML_PATH).href : new URL('../dist/index.html', import.meta.url).href);
  const network = page.locator('[aria-label="团队联网同步"]');
  assert(await network.getByText(/尚未同步到团队/).isVisible());
  assert(await network.getByRole('button', { name: '拉取团队数据', exact: true }).isDisabled());
  assert(await network.getByRole('button', { name: '登录 / 联网设置', exact: true }).isVisible());
  const collaboration = page.getByRole('button', { name: '协作', exact: true });
  await collaboration.waitFor();
  assert.equal(await page.getByRole('button', { name: /专注/ }).count(), 0);
  assert.equal(await page.locator('.pipeline-workspace, .pipeline-sdk-settings, .pipeline-sdk-search').count(), 0);
  await collaboration.click();
  const instruction = page.getByRole('textbox', { name: '协作提示', exact: true });
  assert.equal(await instruction.inputValue(), '旧协作提示：先核验任务');
  await instruction.fill('先检查证据，再给下一步建议');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  assert.equal(await page.evaluate(() => window.testData['pipeline:assist-instruction']), '先检查证据，再给下一步建议');
  await page.getByRole('button', { name: '放入对话草稿', exact: true }).click();
  await page.getByRole('button', { name: '请 Being 协助', exact: true }).click();
  await page.getByRole('button', { name: '打开对话', exact: true }).click();
  const calls = await page.evaluate(() => window.testCalls);
  assert.deepEqual(calls.map(call => call.type), ['compose', 'chat', 'navigate']);
  assert(calls[0].message.startsWith('先检查证据，再给下一步建议\n\n星轨：'));
  assert.equal(calls[2].location, 'chat');
  record('协作提示沿用原键并可保存；三个 Being 按钮携带上下文调用宿主接口');
  await collaboration.click();
  await page.getByText('从模板新建', { exact: true }).click();
  await page.getByRole('button', { name: '轻流程', exact: true }).click();
  await page.waitForFunction(storageKey => JSON.parse(window.testData[storageKey]).demands.at(-1).workflowId === 'light-star-track', key);
  assert.equal(await page.locator('.react-flow__node-station').count(), 3);
  assert.equal(await page.locator('.react-flow__node-item').count(), 4);
  const station = page.locator('.react-flow__node-station[data-id="L-S01"] .star-map-station');
  const stationMetrics = () => station.evaluate(element => {
    const style = getComputedStyle(element);
    const heading = element.querySelector('.star-map-station-heading');
    const summary = element.querySelector('p');
    const bounds = element.getBoundingClientRect();
    const headingBounds = heading.getBoundingClientRect();
    const summaryBounds = summary.getBoundingClientRect();
    return {
      width: style.width, height: style.height,
      paddingTop: style.paddingTop, paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft, paddingRight: style.paddingRight,
      idFont: getComputedStyle(heading.querySelector('span')).fontSize,
      titleFont: getComputedStyle(heading.querySelector('strong')).fontSize,
      summaryFont: getComputedStyle(summary).fontSize,
      contentFits: headingBounds.top >= bounds.top && summaryBounds.bottom <= bounds.bottom && heading.scrollWidth <= heading.clientWidth && summary.scrollWidth <= summary.clientWidth,
    };
  });
  const expanded = await stationMetrics();
  assert.equal(expanded.titleFont, '13px');
  assert.equal(expanded.summaryFont, '10px');
  assert.equal(expanded.paddingTop, '13px');
  await page.getByRole('button', { name: '缩小', exact: true }).click();
  await page.getByRole('button', { name: '缩小', exact: true }).click();
  await page.waitForFunction(() => {
    const element = document.querySelector('.react-flow__node-station[data-id="L-S01"] .star-map-station.is-compact');
    return element && getComputedStyle(element).height === '96px';
  });
  const compactStation = await stationMetrics();
  assert.equal(compactStation.width, '286px');
  assert.equal(compactStation.height, '96px');
  assert.equal(compactStation.paddingTop, '8px');
  assert.equal(compactStation.paddingBottom, '8px');
  assert.equal(compactStation.paddingLeft, '18px');
  assert.equal(compactStation.paddingRight, '18px');
  assert.equal(compactStation.idFont, '11px');
  assert.equal(compactStation.titleFont, '14px');
  assert.equal(compactStation.summaryFont, '12px');
  assert(compactStation.contentFits);
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await page.waitForFunction(height => {
    const element = document.querySelector('.react-flow__node-station[data-id="L-S01"] .star-map-station');
    return element && !element.classList.contains('is-compact') && getComputedStyle(element).height === height;
  }, expanded.height);
  assert.deepEqual(await stationMetrics(), expanded);
  record('缩小态字号、内边距与 96px 高度一致且无溢出；放大后展开态尺寸与文字不变');
  const selectNode = async nodeId => { await page.locator(`.react-flow__node-item[data-id="${nodeId}"] strong`).click(); };
  await selectNode('L-N02');
  const guidance = page.locator('.pipeline-detail-core details');
  assert.equal(await guidance.evaluate(element => element.open), false);
  assert.equal(await guidance.getByRole('textbox').isVisible(), false);
  const statusSelect = page.locator('.pipeline-detail-meta select');
  assert.deepEqual(await statusSelect.locator('option').allTextContents(), ['待开始', '可开始', '进行中', '待评审', '受阻', '失败', '完成', '已跳过']);
  await guidance.locator('summary').click();
  await guidance.getByRole('textbox').fill('处理说明\n\n完成证据：可核验的处理结果');
  assert.equal(await guidance.getByRole('textbox').inputValue(), '处理说明\n\n完成证据：可核验的处理结果');
  await page.getByRole('combobox', { name: '当前场景任务', exact: true }).selectOption('test-task');
  await page.getByRole('button', { name: '应用任务状态到节点', exact: true }).click();
  assert.equal(await statusSelect.inputValue(), 'running');
  record('轻流程可新建；节点说明默认折叠且可编辑；八态文案和节点任务关联通过');
  await selectNode('L-N03');
  await statusSelect.selectOption('running');
  assert.equal(await statusSelect.inputValue(), 'running');
  await selectNode('L-G01');
  await page.getByText('更多信息', { exact: true }).click();
  assert(await page.getByRole('button', { name: '闸口或结构规则保护，不可删除', exact: true }).isDisabled());
  assert(await page.getByLabel('类型', { exact: true }).isDisabled());
  await page.locator('.react-flow__node-item[data-id="L-G01"]').click();
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('.react-flow__node-item[data-id="L-G01"]').count(), 1);
  await selectNode('L-N03');
  await statusSelect.selectOption('running');
  assert.equal(await statusSelect.inputValue(), 'running');
  await page.locator('.react-flow__node-station[data-id="L-S01"] strong').click();
  assert.equal(await page.locator('.pipeline-detail-core details').evaluate(element => element.open), false);
  record('站说明默认折叠；闸口防删除但不硬阻断下游；未登录禁用联网并显示登录入口');
  await page.getByRole('button', { name: '+ 新建星轨', exact: true }).click();
  await page.waitForFunction(storageKey => JSON.parse(window.testData[storageKey]).demands.at(-1).workflowId === 'blank-star-track', key);
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node-station, .react-flow__node-item').length === 0);
  assert.equal(await page.locator('.react-flow__node-station').count(), 0);
  assert.equal(await page.locator('.react-flow__node-item').count(), 0);
  const saved = await page.evaluate(storageKey => JSON.parse(window.testData[storageKey]), key);
  assert.equal(saved.schemaVersion, 4);
  assert.equal(saved.demands[0].id, models.defaultDemand.id);
  assert.equal(saved.demands[1].id, models.defaultBugDemand.id);
  assert.equal(await page.evaluate(() => Object.keys(JSON.parse(window.testData['pipeline:task-bindings'])).length), 1);
  assert.deepEqual(errors, []);
  record('一键新建仍为空白；既有星轨、任务绑定和 schemaVersion 保留；无页面异常');
  console.log(`${results.length} targeted checks passed (mock Grove SDK; no live Being requests).`);
} finally {
  await browser.close();
}
