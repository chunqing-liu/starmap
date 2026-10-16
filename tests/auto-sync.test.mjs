import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { gitlabFixture, memoryCache } from './network-fixture.mjs';

const compiled = await build({ bundle: true, write: false, platform: 'node', format: 'esm', stdin: { contents: 'export * from "./src/host"; export * from "./src/auto-sync"; export * from "./src/network-auth"; export * from "./src/gitlab-client"; export * from "./src/storage"; export * from "./src/sync"; export * from "./src/models/templates";', resolveDir: fileURLToPath(new URL('../', import.meta.url)) } });
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const initial = () => api.createInitialPipelineState();
const settle = async () => { for (let index = 0; index < 15; index++) await new Promise(resolve => setImmediate(resolve)); };
function clock() {
  let now = 0, serial = 0;
  const timers = new Map(), listeners = new Set();
  return { shown: true, connected: true, timers, listeners, visible() { return this.shown; }, online() { return this.connected; }, now: () => now,
    later(callback, delay) { const id = ++serial; timers.set(id, { callback, at: now + delay }); return id; }, cancel(id) { timers.delete(id); },
    listen(callback) { listeners.add(callback); return () => listeners.delete(callback); }, change(values) { Object.assign(this, values); listeners.forEach(callback => callback()); },
    async advance(duration) {
      const end = now + duration;
      for (let count = 0; count < 1000; count++) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((first, second) => first[1].at - second[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].callback(); await settle();
        if (count === 999) throw new Error('Unexpected timer loop');
      }
      now = end; await settle();
    }, nextDelay() { return Math.min(...[...timers.values()].map(timer => timer.at - now)); },
  };
}
function client(server, cache = memoryCache(), account = '') {
  const sync = new api.TeamSync(api.createTeamStorage(server.fetch, async () => 'fixture-only', server.config), cache, 'isolated-test', initial(), account);
  const environment = clock(), controller = new api.AutoSync(sync, 'Fixture', environment);
  return { sync, environment, controller, cache };
}
async function edit(sync, change) { const draft = structuredClone(sync.snapshot().draft); change(draft); await sync.stage(draft); }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('模拟：评论 / 任务 / 催办按账号隔离，在途本机写入固定原账号', async () => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document, stored = { legacy: 'offline' };
  globalThis.window = { grove: { loadData: async () => stored, updateData: async patch => Object.assign(stored, patch) } };
  globalThis.document = { getElementById: () => null };
  try {
    await api.initializeStorage(); const offline = api.capturePluginStorage(); api.setPluginAccountScope('repo:A');
    const first = api.capturePluginStorage(); await first.setItems({ comment: 'A comment', 'pipeline:task-bindings': 'A task', reminder: 'A attempt' });
    api.setPluginAccountScope('repo:B'); assert.equal(api.pluginStorage.getItem('comment'), null); assert.equal(api.pluginStorage.getItem('pipeline:task-bindings'), null);
    await first.setItems({ reminder: 'A delayed result' }); await offline.setItems({ legacy: 'offline delayed result' });
    assert.equal(api.pluginStorage.getItem('reminder'), null); assert.equal(api.pluginStorage.getItem('legacy'), null);
    await api.pluginStorage.setItems({ comment: 'B comment' }); api.setPluginAccountScope('repo:A');
    assert.equal(api.pluginStorage.getItem('comment'), 'A comment'); assert.equal(api.pluginStorage.getItem('reminder'), 'A delayed result'); api.setPluginAccountScope(''); assert.equal(api.pluginStorage.getItem('legacy'), 'offline delayed result');
  } finally { api.setPluginAccountScope(''); globalThis.window = previousWindow; globalThis.document = previousDocument; }
});
test('模拟：在途失败期间重连，多次唤醒只在结束后立即重查，不重叠', async () => {
  const server = gitlabFixture(initial()), instance = client(server), hold = deferred();
  instance.controller.start(); await instance.environment.advance(0);
  const fetch = instance.sync.remote.revision; let requests = 0;
  instance.sync.remote.revision = async space => { requests++; if (requests === 1) { await hold.promise; throw new api.NetworkError('network', 'fixture offline'); } return fetch(space); };
  await instance.environment.advance(5000); instance.controller.wake(); instance.controller.wake(); assert.equal(requests, 1); hold.resolve(); await settle();
  assert.equal(instance.environment.nextDelay(), 0); await instance.environment.advance(0); assert.equal(requests, 2); instance.controller.stop();
});
test('安全：精确公司 origin 以外的 HTTP 在读取 provider 和请求前阻断', async () => {
  let reads = 0, calls = 0;
  for (const baseUrl of ['http://127.0.0.1:9001', 'http://newgit.d5techs.com.cn:81', 'http://newgit.d5techs.com.cn.evil.invalid', 'http://evil-newgit.d5techs.com.cn', 'http://newgit.d5techs.com.cn.', 'http://newgit.d5techs.com.cn@127.0.0.1', 'http://newgit.d5techs.com.cn/path', 'http://newgit.d5techs.com.cn?token=fixture', 'http://newgit.d5techs.com.cn#fixture']) {
    if (new URL(baseUrl).username || new URL(baseUrl).pathname !== '/' || new URL(baseUrl).search || new URL(baseUrl).hash) {
      assert.throws(() => new api.GitLabClient(async () => { calls++; }, async () => { reads++; return 'fixture-only'; }, { baseUrl, projectId: 9001, branch: 'master' }), failure => failure.code === 'format');
      continue;
    }
    const connection = new api.GitLabClient(async () => { calls++; }, async () => { reads++; return 'fixture-only'; }, { baseUrl, projectId: 9001, branch: 'master' });
    await assert.rejects(connection.identity(), failure => failure.code === 'insecure');
    await assert.rejects(connection.save('isolated-test', initial(), null, 'Fixture'), failure => failure.code === 'insecure');
  }
  assert.equal(reads, 0); assert.equal(calls, 0);
});
test('模拟：公司 HTTP 仅按 URL.origin 精确放行，规范化默认端口 / 大小写可登录', async () => {
  for (const baseUrl of ['http://newgit.d5techs.com.cn', 'HTTP://NEWGIT.D5TECHS.COM.CN:80/']) {
    const server = gitlabFixture(initial(), 'isolated-test', 'collaboration'); server.config.baseUrl = api.AUTHORIZED_HTTP_ORIGIN; server.config.projectId = 9001;
    const token = 'fixture-company-http-session', cache = memoryCache();
    const host = async (url, init) => { assert.equal(new URL(url).origin, api.AUTHORIZED_HTTP_ORIGIN); assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + token); assert(!url.includes(token)); return server.fetch(url, init); };
    const login = new api.SessionLogin(host, cache, initial, server.config);
    const sync = await login.connect(token, baseUrl, 'isolated-test'); await sync.pull();
    assert.equal(login.snapshot().target, api.AUTHORIZED_HTTP_ORIGIN); assert.equal(sync.snapshot().status, 'synced'); assert.equal(server.commits, 0);
    assert(!JSON.stringify(cache.values).includes(token)); login.disconnect();
  }
});
test('安全：跨 origin 最终响应被拒绝，读停止轮询 / 写不盲目重发', async () => {
  const host = async () => { const response = new Response('{}'); Object.defineProperty(response, 'url', { value: 'http://other.invalid/redirected' }); return response; };
  const connection = new api.GitLabClient(host, async () => 'fixture-only', { baseUrl: 'https://gitlab.fixture.invalid', projectId: 9001, branch: 'collaboration' });
  await assert.rejects(connection.identity(), failure => failure.code === 'forbidden');
  const server = gitlabFixture(initial()), changed = initial(); changed.demands[0].summary = 'fixture changed';
  let writes = 0;
  const writer = new api.GitLabClient(async (url, init) => { if (init.method === 'POST') { writes++; return host(); } return server.fetch(url, init); }, async () => 'fixture-only', server.config);
  const base = await writer.load('isolated-test');
  await assert.rejects(writer.save('isolated-test', changed, base.rev, 'Fixture'), failure => failure.code === 'unknown');
  assert.equal(writes, 1); assert.equal(server.commits, 0);
});
test('安全：超出宿主 RPC 上限在提交前明确阻断，不产生回执不明重试', async () => {
  const server = gitlabFixture(initial()), instance = client(server); await instance.sync.pull();
  await edit(instance.sync, draft => { draft.demands[0].summary = '隔'.repeat(400000); }); await instance.sync.push('Fixture');
  assert.equal(server.commits, 0); assert.equal(instance.sync.snapshot().errorCode, 'format'); assert.equal(instance.sync.snapshot().pending, null); assert(!server.calls.some(call => call.method === 'POST'));
});
test('模拟：会话登录核验账号 / 仓库，令牌只在 Authorization，重开未登录', async () => {
  const server = gitlabFixture(initial()), cache = memoryCache(), requests = [];
  const token = 'fixture-ephemeral-secret';
  const host = async (url, init) => { assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + token); assert(!url.includes(token)); assert(!(init.body || '').includes(token)); requests.push(init.method || 'GET'); return server.fetch(url, init); };
  const login = new api.SessionLogin(host, cache, initial, server.config);
  const sync = await login.connect(token, server.config.baseUrl, 'isolated-test'); await sync.pull();
  assert.equal(login.snapshot().user.id, 101); assert.equal(sync.snapshot().status, 'synced'); assert(requests.every(method => method === 'GET'));
  assert(!JSON.stringify(cache.values).includes(token)); assert(!JSON.stringify(login).includes(token)); assert(!JSON.stringify(sync.snapshot()).includes(token));
  const reopened = new api.SessionLogin(host, cache, initial, server.config); assert.equal(reopened.snapshot().connected, false);
  login.disconnect(); const calls = requests.length; await sync.pull(); await sync.push('revoked'); assert.equal(requests.length, calls);
});
test('模拟：切账号不上传 / 展示前账号草稿，切回恢复原草稿；不改旧离线键', async () => {
  const server = gitlabFixture(initial()), cache = memoryCache({ [api.PIPELINE_STORAGE_KEY]: 'offline-preserved' });
  const host = async (url, init) => new URL(url).pathname === '/api/v4/user' ? new Response(JSON.stringify({ id: new Headers(init.headers).get('Authorization').endsWith('account-A') ? 1 : 2, username: 'fixture-account' })) : server.fetch(url, init);
  const login = new api.SessionLogin(host, cache, initial, server.config);
  const first = await login.connect('account-A', server.config.baseUrl, 'isolated-test'); await first.pull(); await edit(first, draft => { draft.demands[0].title = 'A private draft'; });
  const second = await login.connect('account-B', server.config.baseUrl, 'isolated-test'); await second.pull();
  assert.notEqual(first.key, second.key); assert.notEqual(second.snapshot().draft.demands[0].title, 'A private draft'); assert.equal(server.commits, 0);
  assert.equal(cache.values[api.PIPELINE_STORAGE_KEY], 'offline-preserved');
  const restored = await login.connect('account-A', server.config.baseUrl, 'isolated-test'); assert.equal(restored.snapshot().draft.demands[0].title, 'A private draft');
});
test('模拟：首次登录拉取断网并重开后，未编辑的内置种子不会混入团队数据', async () => {
  const remote = initial(); remote.demands = [api.createDemand('remote-only')]; remote.selectedDemandId = remote.demands[0].id;
  const server = gitlabFixture(remote), cache = memoryCache(), storage = api.createTeamStorage(server.fetch, async () => 'fixture-only', server.config);
  const first = new api.TeamSync(storage, cache, 'isolated-test', initial(), '101', true); server.offline = true; await first.pull(); first.dispose();
  const reopened = new api.TeamSync(storage, cache, 'isolated-test', initial(), '101', true); server.offline = false; await reopened.pull();
  assert.equal(reopened.snapshot().status, 'synced'); assert.equal(reopened.snapshot().draft.demands.length, 1); assert.equal(reopened.snapshot().draft.demands[0].title, 'remote-only'); assert.equal(server.commits, 0);
});
test('模拟：取消登录和已退出账号的在途响应不会重新激活或污染新账号', async () => {
  const server = gitlabFixture(initial()), hold = deferred(), login = new api.SessionLogin(server.fetch, memoryCache(), initial, server.config);
  server.beforeRead = () => hold.promise;
  const first = await login.connect('account-A', server.config.baseUrl, 'isolated-test');
  let applied = 0; first.subscribe(() => applied++); const pulling = first.pull(); await settle(); login.disconnect(); const before = applied; hold.resolve(); await pulling;
  assert.equal(applied, before); assert.equal(login.snapshot().connected, false); assert.equal(first.snapshot().base, null);
  const userHold = deferred();
  const delayed = new api.SessionLogin(async (url, init) => { if (new URL(url).pathname === '/api/v4/user') await userHold.promise; return server.fetch(url, init); }, memoryCache(), initial, server.config);
  const connecting = delayed.connect('account-A', server.config.baseUrl, 'isolated-test'); await settle(); delayed.disconnect(); userHold.resolve(); await assert.rejects(connecting); assert.equal(delayed.snapshot().connected, false);
});
test('模拟双独立客户端：编辑 800ms 合并一次自动提交，5 秒版本检查传播，无手动拉推', async () => {
  const server = gitlabFixture(initial()), first = client(server), second = client(server);
  first.controller.start(); second.controller.start(); await first.environment.advance(0); await second.environment.advance(0);
  await edit(first.sync, draft => { draft.demands[0].title = 'coalesced-1'; }); await first.environment.advance(400);
  await edit(first.sync, draft => { draft.demands[0].title = 'coalesced-2'; }); await first.environment.advance(799); assert.equal(server.commits, 0);
  await first.environment.advance(1); assert.equal(server.commits, 1); await second.environment.advance(5000);
  assert.equal(second.sync.snapshot().draft.demands[0].title, 'coalesced-2'); assert(api.sameState(first.sync.snapshot().draft, second.sync.snapshot().draft));
  first.controller.stop(); second.controller.stop();
});
test('模拟双独立客户端：不同字段并发自动合并，同处冲突停止且选择后再自动同步', async () => {
  const server = gitlabFixture(initial()), first = client(server), second = client(server);
  first.controller.start(); second.controller.start(); await first.environment.advance(0); await second.environment.advance(0);
  await edit(first.sync, draft => { draft.demands[0].title = 'A title'; }); await edit(second.sync, draft => { draft.demands[0].summary = 'B summary'; });
  await first.environment.advance(800); await second.environment.advance(1700); await first.environment.advance(5000);
  assert.equal(server.state().demands[0].title, 'A title'); assert.equal(server.state().demands[0].summary, 'B summary');
  await edit(first.sync, draft => { draft.demands[0].title = 'A collision'; }); await edit(second.sync, draft => { draft.demands[0].title = 'B collision'; });
  await first.environment.advance(800); await second.environment.advance(800);
  assert.equal(second.sync.snapshot().status, 'conflict'); const commits = server.commits; await second.environment.advance(15000); assert.equal(server.commits, commits);
  await second.sync.resolve(Object.fromEntries(second.sync.snapshot().conflicts.map(conflict => [conflict.path, 'local']))); second.controller.wake(); await second.environment.advance(1000);
  assert.equal(server.state().demands[0].title, 'B collision'); first.controller.stop(); second.controller.stop();
});
test('模拟：断网保留草稿并指数退避，编辑不绕过退避，重连立即先检查再自动上传', async () => {
  const server = gitlabFixture(initial()), instance = client(server); instance.controller.start(); await instance.environment.advance(0);
  server.offline = true; await edit(instance.sync, draft => { draft.demands[0].title = 'offline draft'; }); await instance.environment.advance(800);
  assert.equal(instance.sync.snapshot().status, 'offline'); assert.equal(instance.environment.nextDelay(), 10000);
  await edit(instance.sync, draft => { draft.demands[0].summary = 'kept'; }); assert.equal(instance.environment.nextDelay(), 10000);
  await instance.environment.advance(10000); assert.equal(instance.environment.nextDelay(), 20000);
  server.offline = false; instance.environment.change({ connected: true }); await instance.environment.advance(0);
  assert.equal(server.commits, 1); assert.equal(server.state().demands[0].title, 'offline draft'); instance.controller.stop();
});
test('模拟：丢失提交回执只核验，确认已落库后不重复提交', async () => {
  const server = gitlabFixture(initial()), instance = client(server); instance.controller.start(); await instance.environment.advance(0);
  server.loseReply = true; await edit(instance.sync, draft => { draft.demands[0].title = 'lost ack'; }); await instance.environment.advance(800);
  assert.equal(instance.sync.snapshot().status, 'unknown'); assert.equal(server.commits, 1);
  await instance.environment.advance(10000); assert.equal(instance.sync.snapshot().status, 'synced'); assert.equal(server.commits, 1); instance.controller.stop();
});
test('模拟：慢请求轮询不重叠，多次激活合并，停止取消订阅且在途结束不续订', async () => {
  const server = gitlabFixture(initial()), hold = deferred(), instance = client(server); server.beforeRead = () => hold.promise;
  instance.controller.start(); await instance.environment.advance(0); const calls = server.calls.length;
  instance.controller.wake(); instance.controller.wake(); await instance.environment.advance(30000); assert.equal(server.calls.length, calls);
  instance.controller.stop(); assert.equal(instance.environment.listeners.size, 0); hold.resolve(); await settle(); assert.equal(instance.environment.timers.size, 0);
  await edit(instance.sync, draft => { draft.demands[0].title = 'stopped'; }); await instance.environment.advance(60000); assert.equal(server.commits, 0);
});
test('模拟：隐藏 / 离线时不轮询不上传，重新激活立即检查，再继续同步', async () => {
  const server = gitlabFixture(initial()), instance = client(server); instance.controller.start(); await instance.environment.advance(0);
  instance.environment.change({ shown: false }); const calls = server.calls.length;
  await edit(instance.sync, draft => { draft.demands[0].title = 'hidden'; }); await instance.environment.advance(60000); assert.equal(server.calls.length, calls);
  instance.environment.change({ shown: true, connected: false }); await instance.environment.advance(60000); assert.equal(server.calls.length, calls); assert.equal(instance.sync.snapshot().status, 'offline');
  instance.environment.change({ connected: true }); await instance.environment.advance(0); assert.equal(server.commits, 1); instance.controller.stop();
});
test('模拟负载：稳定空间一分钟仅 12 次 HEAD，无正文下载 / POST', async context => {
  const server = gitlabFixture(initial()), instance = client(server); instance.controller.start(); await instance.environment.advance(0); server.calls.length = 0;
  const started = performance.now(); await instance.environment.advance(60000);
  assert.equal(server.calls.length, 12); assert(server.calls.every(call => call.method === 'HEAD')); assert.equal(server.commits, 0);
  context.diagnostic('Simulated 60s: 12 HEAD, 0 GET body, 0 POST; local harness elapsed ' + Math.round(performance.now() - started) + 'ms. Not production load.'); instance.controller.stop();
});
test('模拟：403 停止轮询，缓存失败与空空间禁止自动首次创建', async () => {
  const denied = gitlabFixture(initial()), first = client(denied); denied.deny = 403; first.controller.start(); await first.environment.advance(0); const calls = denied.calls.length;
  await edit(first.sync, draft => { draft.demands[0].title = 'no bypass'; }); await first.environment.advance(60000); assert.equal(denied.calls.length, calls); first.controller.stop();
  const empty = gitlabFixture(null), second = client(empty); second.controller.start(); await second.environment.advance(60000); assert.equal(empty.commits, 0); second.controller.stop();
  const server = gitlabFixture(initial()), cache = memoryCache(), third = client(server, cache); third.controller.start(); await third.environment.advance(0); cache.fail = true;
  await assert.rejects(edit(third.sync, draft => { draft.demands[0].title = 'quota'; })); const before = server.calls.length; await third.environment.advance(60000); assert.equal(server.commits, 0); assert.equal(server.calls.length, before); third.controller.stop();
});
