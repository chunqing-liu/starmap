import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const project = fileURLToPath(new URL('../', import.meta.url));
const compiled = await build({ bundle: true, write: false, format: 'esm', platform: 'node',
  stdin: { contents: 'export * from "./src/models/templates";', resolveDir: project },
});
const models = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const key = models.PIPELINE_STORAGE_KEY, backupKey = 'beings:star-map:pre-import-backup';
const initial = JSON.parse(JSON.stringify(models.sanitizePipelineState(models.createInitialPipelineState())));
const spaceName = initial.board.name;
const evidence = new URL('../.npm-cache/team-sync-evidence/', import.meta.url);
await mkdir(evidence, { recursive: true });
const records = [];
const record = name => { records.push(name); console.log('PASS: ' + name); };
const browser = await chromium.launch({ headless: true, ...(process.env.STARMAP_BROWSER_PATH ? { executablePath: process.env.STARMAP_BROWSER_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.addInitScript(({ storageKey, state, backupStorageKey }) => {
    const stored = { [storageKey]: JSON.stringify(state), 'pipeline:assist-instruction': '保留协作提示' };
    window.testData = stored; window.testWrites = []; window.failBackup = false;
    localStorage.setItem('不相关浏览器存储', '逐字节保留');
    window.grove = {
      view: 'board', loadData: async () => stored,
      updateData: async patch => {
        window.testWrites.push(Object.keys(patch));
        await new Promise(resolve => setTimeout(resolve, 10));
        if (window.failBackup && backupStorageKey in patch) throw new Error('QuotaExceededError');
        Object.assign(stored, patch);
      },
      being: { context: async () => ({ connected: true, name: 'Being', sceneLabel: '文件交换验收' }),
        onDelta: () => () => {}, tasks: { list: async () => ({ ready: true, tasks: [] }), onChange: async () => () => {} } },
    };
  }, { storageKey: key, state: initial, backupStorageKey: backupKey });
  await page.goto(new URL('../dist/index.html', import.meta.url).href);
  await page.evaluate(() => {
    const policy = document.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy'; policy.content = "connect-src 'none'";
    document.head.append(policy);
  });
  await page.getByRole('button', { name: '协作', exact: true }).click();
  const section = page.getByRole('region', { name: '团队同步（文件交换）', exact: true });
  await section.getByRole('button', { name: '导出团队包', exact: true }).waitFor();
  const before = await page.evaluate(() => JSON.stringify(window.testData));
  const downloadEvent = page.waitForEvent('download');
  await section.getByRole('button', { name: '导出团队包', exact: true }).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /^starmap-export-[0-9]{8}-[0-9]{4}[.]json$/);
  await download.saveAs(fileURLToPath(new URL('export.json', evidence)));
  const exported = JSON.parse(await readFile(new URL('export.json', evidence), 'utf8'));
  assert.equal(exported.schema, 'beings:star-map:team-export'); assert.equal(exported.version, 1); assert.equal(exported.app_version, '1.4.0');
  assert.deepEqual(exported.spaces[spaceName].state, initial);
  assert.match(await page.locator('#plugin-toast').textContent(), /1 个空间、2 条星轨/);
  assert.equal(await page.evaluate(() => JSON.stringify(window.testData)), before);
  record('真实 Blob 下载成功，JSON 与 sanitize 后的 v4 deep-equal，toast 计数正确');
  const upload = async text => {
    await section.getByRole('button', { name: '导入团队包', exact: true }).click();
    await section.getByLabel('选择团队包', { exact: true }).setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  };
  const snapshot = () => page.evaluate(() => ({ privateData: JSON.stringify(window.testData), browserData: JSON.stringify(Object.fromEntries(Object.entries(localStorage))), writes: window.testWrites.length }));
  for (const [text, message] of [
    ['{broken', /JSON 无法解析/],
    [JSON.stringify({ ...exported, schema: 'wrong' }), /schema 不符/],
    [JSON.stringify({ ...exported, version: 2 }), /来自更新的版本，请先升级插件/],
  ]) {
    const unchanged = await snapshot(); await upload(text);
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    assert.match(await section.getByRole('alert').textContent(), message);
    assert.deepEqual(await snapshot(), unchanged);
  }
  record('坏包三连测：具体文案，宿主私有数据和 localStorage 逐字节不变，无写调用');
  const incoming = structuredClone(initial);
  incoming.demands[0].title = '团队导入星轨'; incoming.demands[0].summary = '整体替换摘要';
  incoming.demands.push({ ...structuredClone(incoming.demands[0]), id: 'import-only', title: '导入独有星轨' });
  const teamText = JSON.stringify({ ...exported, spaces: { [spaceName]: { state: incoming } } });
  for (const choice of ['keep', 'replace', 'merge']) {
    const unchanged = await snapshot(); await upload(teamText);
    const dialog = page.getByRole('dialog', { name: '导入团队包', exact: true });
    await dialog.getByLabel('空间「' + spaceName + '」导入方式', { exact: true }).selectOption(choice);
    await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
    const report = page.getByRole('dialog', { name: '导入报告', exact: true });
    await report.waitFor();
    const saved = await page.evaluate(storageKey => JSON.parse(window.testData[storageKey]), key);
    if (choice === 'keep') { assert.deepEqual(saved, initial); assert.deepEqual(await snapshot(), unchanged); }
    else {
      assert.deepEqual(saved, JSON.parse(JSON.stringify(models.sanitizePipelineState(incoming))));
      const writes = await page.evaluate(() => window.testWrites.slice(-2));
      assert.deepEqual(writes, [[backupKey], [key, 'beings:star-map:team-spaces']]);
      await page.locator('.pipeline-demand-copy strong').filter({ hasText: '团队导入星轨' }).first().waitFor();
    }
    if (choice === 'merge') {
      assert.match(await report.textContent(), /同 id 冲突记录（1）/);
      await report.locator('summary').click();
      assert.match(await report.locator('pre').textContent(), /旧值：.*需求开发任务/s);
      assert.match(await report.locator('pre').textContent(), /新值：.*团队导入星轨/s);
      await page.screenshot({ path: fileURLToPath(new URL('merge-report.png', evidence)) });
    }
    await report.getByRole('button', { name: '关闭报告', exact: true }).click();
    if (choice !== 'keep') {
      await section.getByRole('button', { name: '恢复导入前备份', exact: true }).click();
      const restore = page.getByRole('dialog', { name: '恢复导入前备份', exact: true });
      assert.match(await restore.textContent(), /备份时间：.*空间数：1/s);
      await restore.getByRole('button', { name: '确认恢复', exact: true }).click();
      await page.waitForFunction(storageKey => JSON.parse(window.testData[storageKey]).demands.length === 2, key);
      assert.deepEqual(await page.evaluate(storageKey => JSON.parse(window.testData[storageKey]), key), initial);
    }
  }
  record('真实三选项、整条合并、逐 id 旧→新报告、先备份和恢复全部通过；看板立即刷新');
  const unchanged = await snapshot(); await upload(teamText);
  await page.getByRole('dialog', { name: '导入团队包', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual(await snapshot(), unchanged);
  await page.evaluate(() => { window.failBackup = true; });
  await upload(teamText);
  const dialog = page.getByRole('dialog', { name: '导入团队包', exact: true });
  await dialog.getByLabel('全部空间导入方式', { exact: true }).selectOption('replace');
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  assert.match(await dialog.getByRole('alert').textContent(), /备份写入失败.*未应用团队包/);
  assert.equal((await snapshot()).privateData, unchanged.privateData);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(() => { window.failBackup = false; });
  record('取消零副作用；异步备份失败可见，v4 和已有备份均不变');
  const extra = structuredClone(initial); extra.board.name = '团队乙'; extra.demands[0].title = '团队乙内容';
  await upload(JSON.stringify({ ...exported, spaces: { 团队乙: { state: extra }, 坏空间: null } }));
  await page.getByRole('dialog', { name: '导入团队包', exact: true }).getByRole('button', { name: '确认导入', exact: true }).click();
  const report = page.getByRole('dialog', { name: '导入报告', exact: true }); await report.waitFor();
  assert.match(await report.textContent(), /总空间数：2；新增：1；覆盖：0；合并：0；保留：0；剔除：1/);
  assert.match(await report.textContent(), /剔除「坏空间」：/);
  await report.getByRole('button', { name: '关闭报告', exact: true }).click();
  await section.getByLabel('当前团队空间', { exact: true }).selectOption('团队乙');
  await page.waitForFunction(storageKey => JSON.parse(window.testData[storageKey]).board.name === '团队乙', key);
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  assert.deepEqual(await page.evaluate(storageKey => JSON.parse(window.testData[storageKey]), key), extra);
  await page.screenshot({ path: fileURLToPath(new URL('settings-spaces.png', evidence)) });
  await section.getByRole('button', { name: '恢复导入前备份', exact: true }).click();
  await page.getByRole('dialog', { name: '恢复导入前备份', exact: true }).getByRole('button', { name: '确认恢复', exact: true }).click();
  await page.waitForFunction(storageKey => JSON.parse(window.testData[storageKey]).board.name !== '团队乙', key);
  assert.deepEqual(await page.evaluate(storageKey => JSON.parse(window.testData[storageKey]), key), initial);
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  record('新增空间可切换，剔除原因和计数可见；恢复移除新增空间；无页面异常或 HTTP 请求');
  await writeFile(new URL('ui-results.json', evidence), JSON.stringify({ checks: records, pageErrors: errors, httpRequests: requests }, null, 2));
  console.log(records.length + " UI checks passed (mock Grove SDK; offline file page; connect-src 'none').");
} finally { await browser.close(); }
