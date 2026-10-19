import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { localBackend, isolatedServiceWrapper } from "./desktop-local-backend.mjs";
import { desktopRedirectChecks } from "./desktop-redirects.mjs";
import { nativeVisibilityBootstrap, nativeVisibilityChecks } from "./desktop-native-visibility.mjs";
import { desktopGeometry } from "./desktop-geometry.mjs";
import { desktopStability } from "./desktop-stability.mjs";

const project = fileURLToPath(new URL("../", import.meta.url));
const hostRoot = process.env.STARMAP_HOST_ROOT || path.resolve(project, "../portal-desktop");
const require = createRequire(path.join(hostRoot, "package.json"));
const { _electron: electron } = require("playwright");
const installed = process.env.STARMAP_DESKTOP_EXE || path.join(process.env.LOCALAPPDATA, "Programs/portal-desktop/portal-desktop.exe");
const output = path.join(project, ".npm-cache/desktop-integration");
const run = path.join(output, new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(run, { recursive: true });
const applications = [];
const nativeOnly = process.argv.includes("--native-visibility-only");
const stability = process.argv.includes("--stability");
let backend;
const evidence = { mode: "real installed Electron desktop and public plugin IPC", scope: nativeOnly ? "native visibility only" : "full integration", run, observations: [], rendererErrors: [] };
let phase = "launch installed desktop";
function progress(value) { phase = value; console.log("phase:", value); }
async function until(condition, message, timeout = 16000) {
  const end = Date.now() + timeout;
  while (!await condition()) { if (Date.now() > end) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 80)); }
}
const watchdog = setTimeout(() => { console.error("Desktop integration deadline:", phase); for (const application of applications) application.process().kill(); process.exit(1); }, stability ? 1800000 : 240000);
async function launch(executablePath, args, profile, cwd = project) {
  const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  env.PORTAL_DESKTOP_USER_DATA = profile;
  const application = await electron.launch({ executablePath, args, cwd, env, timeout: 30000 });
  applications.push(application);
  const page = await application.firstWindow();
  page.on("pageerror", error => evidence.rendererErrors.push({ name: error.name, message: error.message.slice(0, 300) }));
  page.on("crash", () => evidence.rendererErrors.push({ name: "RendererCrash", message: "Isolated desktop renderer crashed" }));
  page.setDefaultTimeout(15000);
  const runtime = await application.evaluate(({ app }) => ({ version: app.getVersion(), electron: process.versions.electron, node: process.versions.node, userData: app.getPath("userData"), sessionData: app.getPath("sessionData"), appPath: app.getAppPath(), packaged: app.isPackaged }));
  assert.equal(path.resolve(runtime.userData), path.resolve(profile));
  assert.equal(path.resolve(runtime.sessionData), path.resolve(profile));
  const window = await application.browserWindow(page);
  return { application, page, window, runtime };
}
async function importPlugin(client) {
  progress("import plugin through desktop UI");
  await client.application.evaluate(({ dialog, session, shell }, plugin) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [plugin] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    shell.openExternal = async () => { throw new Error("External navigation disabled in isolated integration test"); };
    session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, callback) => callback({ cancel: true }));
  }, path.join(project, "dist"));
  await client.page.locator("#client-main").waitFor({ state: "visible" });
  if (!await client.page.getByRole("button", { name: "工具库", exact: true }).count()) await client.page.getByRole("button", { name: "更多功能", exact: true }).click();
  await client.page.getByRole("button", { name: "工具库", exact: true }).first().click();
  await client.page.getByRole("tab", { name: "Plugin", exact: true }).click();
  await client.page.getByRole("button", { name: "导入插件目录", exact: true }).click();
  await client.page.locator(".plugin-card").filter({ hasText: "星图流程看板" }).getByRole("button", { name: "星图", exact: true }).click();
  await client.page.frameLocator(".plugin-frame:visible").getByRole("region", { name: "团队联网同步", exact: true }).waitFor();
  client.frame = await (await client.page.locator(".plugin-frame:visible").elementHandle()).contentFrame();
  client.bar = client.frame.getByRole("region", { name: "团队联网同步", exact: true });
}
async function prepareLocalApplication() {
  const archive = process.env.STARMAP_INSTALLED_HOST_ASAR || path.join(path.dirname(installed), "resources/app.asar");
  const asar = require("@electron/asar"), ts = require("typescript");
  const target = path.join(run, "isolated-app");
  asar.extractAll(archive, target);
  const metadata = JSON.parse(await readFile(path.join(target, "package.json"), "utf8"));
  const mainPath = path.join(target, metadata.main);
  const source = await readFile(mainPath, "utf8");
  const parsed = ts.createSourceFile("installed-main.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const services = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && node.getText(parsed).includes('t==="network.fetch"'));
  assert.equal(services.length, 1, "Installed network service must be identified before test-only backend injection");
  await writeFile(mainPath, isolatedServiceWrapper(services[0].name.text, backend.url) + source + nativeVisibilityBootstrap());
  await mkdir(path.join(target, "desktop"), { recursive: true });
  await cp(path.join(target, ".vite/renderer/main_window"), path.join(target, "desktop/generated"), { recursive: true });
  return target;
}
async function login(client, account) {
  const settings = client.bar.getByRole("region", { name: "登录与自动同步设置", exact: true });
  if (!await settings.isVisible()) await client.bar.getByRole("button", { name: "登录 / 联网设置", exact: true }).click();
  await client.bar.getByLabel("GitLab 访问令牌", { exact: true }).waitFor();
  { const details = client.bar.locator("details.pipeline-network-advanced"); if (await details.count() && !await details.evaluate(element => element.open)) await details.locator("summary").click(); }
  await client.bar.getByLabel("GitLab 入口", { exact: true }).fill(backend.fixture.config.baseUrl);
  await client.bar.getByLabel("GitLab 项目 ID", { exact: true }).fill(String(backend.fixture.config.projectId));
  await client.bar.getByLabel("GitLab 目标分支", { exact: true }).fill(backend.fixture.config.branch);
  await client.bar.getByLabel("联网空间标识", { exact: true }).fill("isolated-test");
  await client.bar.getByLabel("GitLab 访问令牌", { exact: true }).fill("local-test-" + account.toLowerCase());
  if (account === "B") await client.bar.getByLabel("GitLab 访问令牌", { exact: true }).press("Enter");
  else await client.bar.getByRole("button", { name: "连接", exact: true }).click();
  await client.bar.getByText(/^已同步 · isolated-test$/).waitFor();
  await client.bar.getByRole("button", { name: "联网设置", exact: true }).click();
  await client.bar.getByLabel("自动同步检查间隔", { exact: true }).selectOption("3");
  await client.bar.getByRole("button", { name: "联网设置", exact: true }).click();
  const expand = client.frame.getByRole("button", { name: "展开右侧详情栏", exact: true });
  if (await expand.isVisible()) await expand.click();
}
const title = client => client.frame.getByRole("textbox", { name: "任务名称", exact: true });
async function activityChecks(client) {
  progress("real Electron activity and simulated reminder interaction");
  const overview = client.frame.getByRole("region", { name: "当前节点与阶段耗时", exact: true });
  await overview.getByText("当前节点 2", { exact: true }).waitFor();
  await overview.getByRole("button", { name: "旧运行节点 · 流程角色", exact: true }).click();
  const timing = client.frame.getByRole("region", { name: "节点真实时间", exact: true });
  assert.equal((await timing.locator("dd").allTextContents()).join("/"), "未记录/未记录/未记录");
  evidence.activity = { historical: await timing.locator("dd").allTextContents() };
  await client.frame.locator('.react-flow__node[data-id="first"]').click();
  const started = Date.now();
  const status = client.frame.locator(".pipeline-detail-meta label").filter({ hasText: "状态" }).locator("select");
  await status.selectOption("running");
  await overview.getByText("当前节点 3", { exact: true }).waitFor();
  await until(() => backend.fixture.state().demands[0].activityEvents?.length === 1, "Activity entry did not upload");
  const entered = backend.fixture.state().demands[0].activityEvents[0].at;
  assert(Date.parse(entered) >= started && Date.parse(entered) <= Date.now());
  await status.selectOption("done");
  await overview.getByText("当前节点 2", { exact: true }).waitFor();
  await until(() => backend.fixture.state().demands[0].activityEvents?.length === 2, "Activity exit did not upload");
  assert.notEqual((await timing.locator("dd").allTextContents())[2], "未记录");
  evidence.activity.recordedDetail = await timing.locator("dd").allTextContents();
  evidence.activity.events = backend.fixture.state().demands[0].activityEvents.map(({ nodeId, from, to, at }) => ({ nodeId, from, to, at }));
  await status.selectOption("running");
  await overview.getByText("当前节点 3", { exact: true }).waitFor();
  await overview.getByRole("button", { name: "催办当前负责 Being（仅模拟）", exact: true }).click();
  const reminder = client.frame.getByRole("region", { name: "模拟催办面板", exact: true });
  assert(await reminder.getByRole("button", { name: "确认模拟催办", exact: true }).isDisabled());
  await reminder.getByRole("button", { name: "只读核验通讯录地址", exact: true }).click();
  await reminder.getByText("Bob · t_bob · 3 个当前节点", { exact: true }).waitFor();
  await reminder.getByRole("button", { name: "确认模拟催办", exact: true }).click();
  await reminder.getByText("t_alice：模拟送达（非真实消息）", { exact: true }).waitFor();
  assert.equal(await reminder.getByLabel("模拟送达结果").locator("li").count(), 2);
  evidence.activity.simulatedRecipients = await reminder.getByLabel("模拟送达结果").locator("li").allTextContents();
  await reminder.getByRole("button", { name: "确认模拟催办", exact: true }).click();
  await reminder.getByText(/五分钟内已模拟催办/).waitFor();
  await client.page.screenshot({ path: path.join(run, "electron-activity-reminder.png") });
  await overview.getByRole("button", { name: "催办当前负责 Being（仅模拟）", exact: true }).click();
  await client.frame.locator('.react-flow__node[data-id="gate"]').click();
  await client.frame.getByText("更多信息", { exact: true }).click();
  assert(await client.frame.getByRole("button", { name: "闸口或结构规则保护，不可删除", exact: true }).isDisabled());
  await status.selectOption("running");
  await overview.getByText("当前节点 4", { exact: true }).waitFor();
  await overview.locator(".activity-stage-details summary").click();
  await overview.getByLabel("阶段耗时", { exact: true }).getByText("并行阶段：未记录", { exact: true }).waitFor();
  evidence.activity.stage = await overview.getByLabel("阶段耗时", { exact: true }).textContent();
  await client.page.screenshot({ path: path.join(run, "electron-gate-stage.png") });
  evidence.observations.push("Electron UI observes real operation entry/exit times; historical times remain unrecorded; parallel current nodes/owners; protected gate still manually operable; reminders simulated only with address verification, per-recipient results and deduplication");
}
try {
  if (!nativeOnly) {
  const client = await launch(installed, [], path.join(run, "installed-profile"));
  evidence.installed = client.runtime;
  await importPlugin(client);
  phase = "installed public IPC company read-only probe";
  evidence.security = await client.frame.evaluate(async () => {
    let parentBlocked = false, storageBlocked = false, nativeNetworkBlocked = false;
    try { void parent.document.body; } catch { parentBlocked = true; }
    try { void localStorage.length; } catch { storageBlocked = true; }
    try { await fetch("http://newgit.d5techs.com.cn/api/v4/user"); } catch { nativeNetworkBlocked = true; }
    return { parentBlocked, storageBlocked, nativeNetworkBlocked, node: typeof window.require, sdk: window.grove.sdkVersion, publicSDKKeys: Object.keys(window.grove).sort(), credentialProviderExposed: ["auth", "credentials", "secrets", "keychain"].some(key => key in window.grove) };
  });
  assert.equal(evidence.security.nativeNetworkBlocked, true);
  assert.equal(evidence.security.parentBlocked, true);
  assert.equal(evidence.security.storageBlocked, true);
  assert.equal(evidence.security.sdk, "1.5.0");
  evidence.company = await client.frame.evaluate(async () => {
    const results = [];
    for (const pathname of ["/api/v4/user", "/api/v4/projects/9001"]) {
      const started = performance.now();
      const response = await window.grove.network.fetch("http://newgit.d5techs.com.cn" + pathname, { method: "GET" });
      results.push({ pathname, status: response.status, origin: new URL(response.url).origin, redirected: response.redirected, durationMs: Math.round(performance.now() - started) });
    }
    return { authenticated: false, transport: "real installed plugin SDK / renderer IPC / main network.fetch / company service", results };
  });
  await client.page.screenshot({ path: path.join(run, "installed-plugin.png") });
  evidence.redirects = await desktopRedirectChecks(client.frame);
  await client.application.close();
  }
  progress("prepare installed host copy and isolated HTTP backend");
  const compiled = await build({ absWorkingDir: project, bundle: true, write: false, format: "esm", platform: "node", stdin: { contents: 'export * from "./src/models/templates";', resolveDir: project } });
  const models = await import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64"));
  const seed = models.createInitialPipelineState();
  const demand = models.createDemand("Electron 隔离双端", "test", models.blankPipeline);
  demand.customStations = [{ id: "stage", kind: "station", title: "并行阶段", subtitle: "隔离测试", nodeIds: ["first", "second", "third", "gate"] }];
  demand.customNodes = [
    { id: "first", title: "新节点", status: "pending", responsibleBeingIds: ["t_alice", "t_bob"] },
    { id: "second", title: "旧运行节点", status: "running", responsibleBeingIds: ["t_bob"] },
    { id: "third", title: "并行等待节点", status: "waiting_human", responsibleBeingIds: ["t_bob"] },
    { id: "gate", title: "不可删除的闸口", status: "pending", kind: "gate", locked: true },
  ].map(node => ({ kind: "node", owner: "流程角色", owner_group: "test", description: "本地隔离验证", trigger: ["人工"], stationId: "stage", ...node }));
  demand.positions = { stage: { x: 70, y: 30 }, first: { x: 110, y: 100 }, second: { x: 110, y: 270 }, third: { x: 110, y: 440 }, gate: { x: 110, y: 610 } };
  seed.demands = [demand]; seed.selectedDemandId = demand.id;
  backend = await localBackend(seed);
  const isolatedApplication = await prepareLocalApplication();
  if (!nativeOnly) {
  const first = await launch(require("electron"), [isolatedApplication], path.join(run, "client-A"), isolatedApplication);
  await importPlugin(first); await login(first, "A");
  const second = await launch(require("electron"), [isolatedApplication], path.join(run, "client-B"), isolatedApplication);
  await importPlugin(second); await login(second, "B");
  evidence.local = { mode: "two real Electron processes; installed host code copied to test directory; only plugin service backend/contact dependencies replaced; real SDK, IPC, registry, permission checks, storage, HTTP sockets; simulated GitLab/accounts", clients: [first.runtime, second.runtime], backend: backend.url };
  progress("two real Electron clients automatic convergence");
  await title(first).fill("A 自动上传，B 自动拉取");
  await until(() => backend.fixture.state().demands[0].title === "A 自动上传，B 自动拉取", "A did not automatically upload");
  await until(async () => await title(second).inputValue() === "A 自动上传，B 自动拉取", "B did not poll and converge");
  evidence.observations.push("Two independent Electron processes/profiles automatically converge through real IPC and local HTTP; no manual refresh");
  progress("concurrent real UI commits and conflict resolution");
  let releaseCommit, reachedCommit;
  const commitReached = new Promise(resolve => { reachedCommit = resolve; });
  const commitRelease = new Promise(resolve => { releaseCommit = resolve; });
  backend.fixture.beforeCommit = async () => { reachedCommit(); await commitRelease; };
  await title(first).fill("A 保留的本地冲突");
  await Promise.race([commitReached, new Promise((_, reject) => setTimeout(() => reject(new Error("A commit did not reach fixture")), 12000))]);
  await title(second).fill("B 先提交的并发修改");
  await until(() => backend.fixture.state().demands[0].title === "B 先提交的并发修改", "B concurrent write did not commit");
  releaseCommit();
  const conflict = first.frame.getByRole("region", { name: "联网字段冲突", exact: true });
  await conflict.waitFor();
  assert.equal(backend.fixture.state().demands[0].title, "B 先提交的并发修改");
  await first.page.screenshot({ path: path.join(run, "electron-conflict.png") });
  for (const selection of await conflict.getByRole("combobox").all()) await selection.selectOption("local");
  await conflict.getByRole("button", { name: "应用冲突选择", exact: true }).click();
  await until(() => backend.fixture.state().demands[0].title === "A 保留的本地冲突", "Conflict choice did not auto upload");
  await until(async () => await title(second).inputValue() === "A 保留的本地冲突", "B did not converge after conflict choice");
  evidence.observations.push("Overlapping writes from two Electron windows: B commits while A receipt is delayed; stale A CAS fails, no silent overwrite; explicit field choice then converges");
  progress("real socket loss, backoff and reconnect");
  backend.offline.add("A");
  await title(first).fill("断网草稿恢复后自动送达");
  await first.bar.getByText(/^离线待传/).waitFor();
  assert.notEqual(backend.fixture.state().demands[0].title, "断网草稿恢复后自动送达");
  await first.page.screenshot({ path: path.join(run, "electron-offline.png") });
  const offlineStart = backend.calls.filter(call => call.account === "A").length;
  await title(first).fill("断网草稿恢复后自动送达");
  await new Promise(resolve => setTimeout(resolve, 900));
  assert.equal(backend.calls.filter(call => call.account === "A").length, offlineStart, "Editing must not bypass retry backoff");
  backend.offline.delete("A");
  await first.frame.evaluate(() => window.dispatchEvent(new Event("online")));
  await until(() => backend.fixture.state().demands[0].title === "断网草稿恢复后自动送达", "Reconnect did not recover pending draft");
  await until(async () => await title(second).inputValue() === "断网草稿恢复后自动送达", "B did not receive recovered draft");
  evidence.observations.push("Local HTTP socket failure produces offline-pending state, edit does not bypass backoff, reconnect event immediately recovers and B converges");
  await activityChecks(first);
  progress("Electron viewport geometry and visibility");
  evidence.geometry = await desktopGeometry(first, run);
  if (stability) evidence.stability = await desktopStability({ first, second, backend, run, login, until, progress, launchAgain: async profile => {
    const next = await launch(require("electron"), [isolatedApplication], profile, isolatedApplication);
    await importPlugin(next); return next;
  } });
  progress("logout and account-isolated pending draft");
  await first.window.evaluate(window => window.setContentSize(1440, 960));
  const detail = first.frame.getByRole("button", { name: "展开右侧详情栏", exact: true }); if (await detail.isVisible()) await detail.click();
  await first.frame.locator(".react-flow__pane").click({ position: { x: 10, y: 10 } });
  await first.bar.getByText(/^已同步 · isolated-test$/).waitFor();
  backend.offline.add("A"); await title(first).fill("仅账号 A 的离线草稿"); await first.bar.getByText(/^离线待传/).waitFor();
  await first.bar.getByRole("button", { name: "联网设置", exact: true }).click();
  await first.bar.getByRole("button", { name: "退出账号", exact: true }).click();
  await login(first, "B");
  assert.notEqual(await title(first).inputValue(), "仅账号 A 的离线草稿");
  await first.bar.getByRole("button", { name: "联网设置", exact: true }).click();
  await first.bar.getByRole("button", { name: "退出账号", exact: true }).click();
  backend.offline.delete("A"); await login(first, "A");
  await until(() => backend.fixture.state().demands[0].title === "仅账号 A 的离线草稿", "A draft did not resume after switching back");
  await first.bar.getByRole("button", { name: "联网设置", exact: true }).click();
  await first.bar.getByRole("button", { name: "退出账号", exact: true }).click();
  const loggedOutCount = backend.calls.filter(call => call.account === "A").length;
  await first.page.reload();
  await new Promise(resolve => setTimeout(resolve, 3500));
  assert.equal(backend.calls.filter(call => call.account === "A").length, loggedOutCount, "Logged-out/unloaded session still makes requests");
  evidence.observations.push("Account A offline draft never appears in B; switching back resumes A draft; logout/reload cancels subscriptions and requires fresh memory-only login");
  evidence.local.metrics = await Promise.all([first, second].map(client => client.application.evaluate(() => globalThis.starmapTestMetrics)));
  for (const metrics of evidence.local.metrics) assert.equal(metrics.messages, 0);
  assert([...backend.maximum.values()].every(count => count <= 1));
  const cache = await second.frame.evaluate(() => window.grove.loadData());
  assert(!JSON.stringify(cache).includes("local-test-a") && !JSON.stringify(cache).includes("local-test-b"));
  await first.application.close(); await second.application.close();
  }
  progress("native Electron visibility without Playwright focus emulation");
  evidence.nativeVisibility = await nativeVisibilityChecks(require("electron"), isolatedApplication, run, path.join(project, "dist"), backend);
  if (stability) {
    evidence.nativeVisibilityRepeats = [];
    for (let iteration = 1; iteration <= 3; iteration++) {
      const folder = path.join(run, "native-repeat-" + iteration); await mkdir(folder, { recursive: true });
      evidence.nativeVisibilityRepeats.push(await nativeVisibilityChecks(require("electron"), isolatedApplication, folder, path.join(project, "dist"), backend));
    }
  }
  evidence.observations.push("Native Electron process without Playwright: actual minimized iframe reports hidden and stops polling; restoring checks the changed remote immediately");
  assert.equal(evidence.rendererErrors.length, 0, "Uncaught renderer errors during desktop integration");
  evidence.passed = true;
  evidence.backendCalls = backend.calls; evidence.maximumConcurrentRequestsPerClient = Object.fromEntries(backend.maximum);
  await writeFile(path.join(run, "results.json"), JSON.stringify(evidence, null, 2));
  await writeFile(path.join(output, "latest.json"), JSON.stringify({ run }, null, 2));
  console.log(JSON.stringify({ passed: true, ...evidence }, null, 2));
} catch (error) {
  if (backend) { evidence.backendCalls = backend.calls; evidence.localFailure = { commits: backend.fixture.commits, nodeTitles: backend.fixture.state().demands[0].customNodes.map(node => node.title) }; }
  await writeFile(path.join(run, "results.json"), JSON.stringify({ ...evidence, passed: false, phase, error: error.message }, null, 2));
  await writeFile(path.join(output, "latest.json"), JSON.stringify({ run }, null, 2));
  for (const [index, application] of applications.entries()) { try { await application.windows()[0]?.screenshot({ path: path.join(run, "failure-" + index + ".png") }); } catch {} }
  throw error;
} finally {
  clearTimeout(watchdog);
  for (const application of applications.reverse()) { try { await application.close(); } catch {} }
  if (backend) await backend.close();
}
