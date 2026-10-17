import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const project = fileURLToPath(new URL('../', import.meta.url));
const hostRoot = process.env.STARMAP_HOST_ROOT || 'E:/beingsspace/portal-desktop-main';
const require = createRequire(path.join(hostRoot, 'package.json'));
const { _electron: electron } = require('playwright');
const installed = process.env.STARMAP_DESKTOP_EXE || path.join(process.env.LOCALAPPDATA, 'Programs/portal-desktop/portal-desktop.exe');
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const run = path.join(project, '.npm-cache/real-connection', stamp);
const candidate = path.resolve(project, '../starmap-candidates/20261016-real-connection', stamp);
const plugin = path.join(candidate, 'plugin');
const target = { origin: 'http://newgit.d5techs.com.cn', projectId: 724, branch: 'starmap-test-20261016', space: 'connection-20261016-1034' };
const applications = [];
const clients = [];
let phase = 'copy checked candidate';
let keepAlive;
const evidence = { mode: 'original installed desktop; no backend substitution or network interception', createdAt: new Date().toISOString(), run, candidate, plugin, target, ready: false, authenticated: false, companyRequests: 'none by preparer', remoteWrites: 0, clients: [] };
await mkdir(plugin, { recursive: true });
await mkdir(run, { recursive: true });
for (const name of ['LICENSE', 'PLUGIN_NOTICES.md', 'README.md', 'THIRD_PARTY_NOTICES', 'desktop.plugin.json', 'index.html']) await copyFile(path.join(project, 'dist', name), path.join(plugin, name));
for (const name of ['desktop-plugin.tar.gz', 'desktop-plugin.sha256']) await copyFile(path.join(project, 'dist', name), path.join(candidate, name));
evidence.sha256 = createHash('sha256').update(await readFile(path.join(candidate, 'desktop-plugin.tar.gz'))).digest('hex');
assert((await readFile(path.join(candidate, 'desktop-plugin.sha256'), 'utf8')).startsWith(evidence.sha256));
const manifest = JSON.parse(await readFile(path.join(plugin, 'desktop.plugin.json'), 'utf8'));
assert.equal(manifest.id, 'community.pipeline');

async function until(condition, description) {
  const deadline = Date.now() + 15000;
  while (!await condition()) {
    if (Date.now() > deadline) throw new Error(description);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

try {
  for (const [index, label] of ['A', 'B'].entries()) {
    phase = 'launch original desktop ' + label; console.log(phase);
    const profile = path.join(run, 'profile-' + label);
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    env.PORTAL_DESKTOP_USER_DATA = profile;
    const application = await electron.launch({ executablePath: installed, args: [], cwd: project, env, timeout: 30000 });
    applications.push(application);
    const page = await application.firstWindow(); page.setDefaultTimeout(20000);
    clients.push({ application, page, process: application.process() });
    const runtime = await application.evaluate(({ app }) => ({ version: app.getVersion(), electron: process.versions.electron, userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), appPath: app.getAppPath(), packaged: app.isPackaged, pid: process.pid }));
    assert.equal(path.resolve(runtime.userData), path.resolve(profile));
    assert.equal(path.resolve(runtime.sessionData), path.resolve(profile));
    assert(['0.1.9', '0.1.10'].includes(runtime.version)); assert.equal(runtime.packaged, true);
    const window = await application.browserWindow(page);
    const area = await application.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
    const width = Math.max(960, Math.min(1440, Math.floor(area.width / 2) - 16));
    const height = Math.min(960, area.height - 24);
    const bounds = { x: area.x + (index ? Math.max(12, area.width - width - 12) : 12), y: area.y + 12, width, height };
    await window.evaluate((window, bounds) => { window.restore(); window.setBounds(bounds); window.show(); }, bounds);
    phase = 'import local candidate ' + label; console.log(phase);
    await application.evaluate(({ dialog }, selection) => {
      globalThis.starmapOriginalDialog = dialog.showOpenDialog;
      globalThis.starmapOriginalMessageBox = dialog.showMessageBox;
      dialog.showOpenDialog = async (...args) => {
        if (args.at(-1).title !== '选择包含 desktop.plugin.json 的插件目录') return globalThis.starmapOriginalDialog(...args);
        globalThis.starmapSelectedCandidate = true;
        return { canceled: false, filePaths: [selection.plugin] };
      };
      dialog.showMessageBox = async (...args) => {
        const options = args.at(-1);
        if (globalThis.starmapSelectedCandidate && options.title === '安装客户端插件' && options.message === '安装并启用 ' + selection.name + ' v' + selection.version + '？' && options.detail.includes('来源：本地目录')) { globalThis.starmapSelectedCandidate = false; return { response: 1, checkboxChecked: false }; }
        return globalThis.starmapOriginalMessageBox(...args);
      };
    }, { plugin, name: manifest.name, version: manifest.version });
    phase = 'wait desktop root ' + label;
    await page.locator('#client-main').waitFor({ state: 'visible' });
    if (!await page.getByRole('button', { name: '工具库', exact: true }).count()) await page.getByRole('button', { name: '更多功能', exact: true }).click();
    phase = 'open tool library ' + label;
    await page.getByRole('button', { name: '工具库', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Plugin', exact: true }).click();
    phase = 'select reviewed local plugin ' + label;
    await page.getByRole('button', { name: '导入插件目录', exact: true }).click();
    phase = 'select imported local catalog entry ' + label;
    const localEntry = page.locator('.catalog-item').filter({ hasText: manifest.name }).filter({ hasText: '✓ 本机存在' });
    await localEntry.waitFor({ state: 'visible' });
    await localEntry.click();
    phase = 'open imported plugin ' + label;
    await page.locator('.plugin-card').filter({ hasText: '星图流程看板' }).getByRole('button', { name: '星图', exact: true }).click();
    phase = 'wait real plugin frame ' + label;
    await page.frameLocator('.plugin-frame:visible').getByRole('region', { name: '团队联网同步', exact: true }).waitFor();
    await application.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.starmapOriginalDialog; dialog.showMessageBox = globalThis.starmapOriginalMessageBox; delete globalThis.starmapOriginalDialog; delete globalThis.starmapOriginalMessageBox; delete globalThis.starmapSelectedCandidate; });
    const frame = await (await page.locator('.plugin-frame:visible').elementHandle()).contentFrame();
    await frame.evaluate(async label => { await window.grove.updateData({ 'beings:star-map:network-client-label': label }); }, label);
    await frame.evaluate(() => { location.reload(); });
    const bar = frame.getByRole('region', { name: '团队联网同步', exact: true });
    await bar.getByLabel('真实联测目标', { exact: true }).filter({ hasText: '窗口 ' + label }).waitFor();
    await bar.getByRole('button', { name: '登录 / 联网设置', exact: true }).click();
    const password = bar.getByLabel('GitLab 访问令牌', { exact: true });
    await password.scrollIntoViewIfNeeded();
    const sdk = await frame.evaluate(() => ({ version: window.grove.sdkVersion, network: typeof window.grove.network.fetch, node: typeof window.require }));
    assert.equal(sdk.version, '1.5.0'); assert.equal(sdk.network, 'function'); assert.equal(sdk.node, 'undefined');
    assert.equal(await bar.getByRole('textbox', { name: 'GitLab 入口', exact: true }).inputValue(), target.origin);
    assert.equal(await bar.getByRole('textbox', { name: 'GitLab 目标分支', exact: true }).inputValue(), target.branch);
    assert.equal(await bar.getByRole('textbox', { name: '联网空间标识', exact: true }).inputValue(), target.space);
    phase = 'settled login geometry ' + label;
    let geometry, previous, stable = 0;
    await page.bringToFront();
    await until(async () => {
      geometry = await frame.evaluate(() => {
        const measure = selector => { const element = document.querySelector(selector), rect = element.getBoundingClientRect(); return { visible: element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }), x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }; };
        return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth, target: measure('.pipeline-network-target'), password: measure('input[type="password"]'), login: measure('.pipeline-network-login button'), settings: measure('.pipeline-network-settings') };
      });
      const current = JSON.stringify(geometry); stable = current === previous ? stable + 1 : 0; previous = current;
      return stable >= 4;
    }, 'Login layout did not stabilize');
    assert(geometry.overflow <= 1);
    for (const element of [geometry.target, geometry.password, geometry.login]) assert(element.visible && element.width > 0 && element.height > 0 && element.x >= 0 && element.right <= geometry.width + 1 && element.y >= 0 && element.bottom <= geometry.height + 1);
    for (const element of [geometry.password, geometry.login]) assert(element.y >= geometry.settings.y && element.bottom <= geometry.settings.bottom + 1);
    const empty = await password.evaluate(element => element.value.length === 0);
    assert(empty, 'Credentials already entered; no screenshot is permitted');
    const screenshot = path.join(run, 'login-' + label + '-before-credentials.png');
    await page.screenshot({ path: screenshot });
    await window.evaluate((window, title) => window.setTitle(title), '星图真实公司联测 ' + label + ' — ' + target.branch);
    await password.focus();
    evidence.clients.push({ label, profile, runtime, sdk, geometry, screenshot, status: 'password login open; no credential entered by preparer' });
  }
  assert.notEqual(evidence.clients[0].runtime.pid, evidence.clients[1].runtime.pid);
  assert.notEqual(evidence.clients[0].profile, evidence.clients[1].profile);
  evidence.ready = true; evidence.readyAt = new Date().toISOString();
  await writeFile(path.join(run, 'ready.json'), JSON.stringify(evidence, null, 2));
  await writeFile(path.join(project, '.npm-cache/real-connection-ready-latest.json'), JSON.stringify(evidence, null, 2));
  console.log('READY: two original installed desktop windows; awaiting human plugin login. Evidence: ' + path.join(run, 'ready.json'));
  keepAlive = setInterval(() => {}, 60000);
  let closed = 0;
  for (const application of applications) application.on('close', () => { if (++closed === applications.length) { clearInterval(keepAlive); process.exit(0); } });
} catch (error) {
  evidence.failure = { phase, name: error.name, code: error.code || null };
  if (error.name === 'TimeoutError') evidence.failure.locator = error.message.split(String.fromCharCode(10)).filter(line => line.includes('waiting for') || line.includes('getByRole') || line.includes('locator(')).slice(0, 5);
  const current = clients.at(-1);
  if (current && !current.page.isClosed()) {
    evidence.failure.controls = await current.page.evaluate(() => ({ buttons: [...document.querySelectorAll('button')].map(button => ({ name: button.textContent.trim().slice(0, 80), label: button.getAttribute('aria-label'), visible: button.checkVisibility() })), pluginCards: [...document.querySelectorAll('.plugin-card')].map(card => card.textContent.slice(0, 600)), frames: [...document.querySelectorAll('iframe')].map(frame => ({ title: frame.title, visible: frame.checkVisibility() })) })).catch(() => null);
    const empty = await current.page.evaluate(() => [...document.querySelectorAll('input[type="password"]')].every(input => !input.value)).catch(() => false);
    if (empty) await current.page.screenshot({ path: path.join(run, 'prepare-failed-before-credentials.png') }).catch(() => {});
  }
  await writeFile(path.join(run, 'prepare-failed.json'), JSON.stringify(evidence, null, 2));
  console.error('Preparation failed: ' + phase + ' (' + error.name + ')');
  for (const client of clients) {
    await Promise.race([client.application.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (client.process.exitCode === null) client.process.kill();
  }
  process.exitCode = 1;
}
