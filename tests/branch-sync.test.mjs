import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { gitlabFixture, memoryCache } from './network-fixture.mjs';

const compiled = await build({ bundle: true, write: false, platform: 'node', format: 'esm', stdin: { contents: 'export * from "./src/gitlab-client"; export * from "./src/network-auth"; export * from "./src/auto-sync"; export * from "./src/models/templates";', resolveDir: fileURLToPath(new URL('../', import.meta.url)) } });
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const initial = () => structuredClone(api.createInitialPipelineState());
const credential = async () => 'synthetic-branch-test-only';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('模拟：HEAD、正文、固定提交元数据、目录和 CAS 写入都使用所选分支', async () => {
  const server = gitlabFixture(initial(), 'isolated-test', 'feature/blue');
  const client = new api.GitLabClient(server.fetch, credential, server.config);
  await client.verifyAccess();
  const before = await client.load('isolated-test');
  assert.equal(await client.revision('isolated-test'), before.rev);
  assert.deepEqual(await client.listSpaces(), ['isolated-test']);
  const next = structuredClone(before.state); next.demands[0].title = 'branch-only';
  await client.save('isolated-test', next, before.rev, 'fixture');
  assert.equal(server.commits, 1);
  assert(server.calls.some(call => call.pathname.endsWith('feature%2Fblue')));
  assert(server.calls.filter(call => call.ref).every(call => call.ref === 'feature/blue' || call.ref.startsWith('commit-')));
  assert(server.calls.every(call => !call.pathname.includes('master') && call.ref !== 'master'));
});

test('模拟：缺分支、403、私仓404不会回退 master 或变成可写空空间', async () => {
  for (const condition of ['missingBranch', 'deny', 'hidden']) {
    const server = gitlabFixture(initial(), 'isolated-test', 'collaboration');
    server[condition] = condition === 'deny' ? 403 : true;
    const client = new api.GitLabClient(server.fetch, credential, server.config);
    for (const operation of [() => client.load('isolated-test'), () => client.revision('isolated-test'), () => client.listSpaces(), () => client.save('isolated-test', initial(), null, 'fixture')]) await assert.rejects(operation);
    assert.equal(server.commits, 0);
    assert(server.calls.every(call => call.method !== 'POST' && call.ref !== 'master' && !call.pathname.endsWith('/master')));
  }
});

test('模拟：公司 master 和未授权 HTTP 端口在请求前禁止写入', async () => {
  let requests = 0;
  for (const override of [{ branch: 'master' }, { baseUrl: api.AUTHORIZED_HTTP_ORIGIN + ':8080' }]) {
    const client = new api.GitLabClient(async () => { requests++; return json({}); }, credential, { baseUrl: api.AUTHORIZED_HTTP_ORIGIN, projectId: 9001, branch: 'collaboration', ...override });
    await assert.rejects(client.save('isolated-test', initial(), null, 'fixture'), error => ['forbidden', 'insecure'].includes(error.code));
  }
  assert.equal(requests, 0);
});

test('模拟：正式登录未配置目标、非法分支及项目时不会发请求', async () => {
  let calls = 0;
  const login = new api.SessionLogin(async () => { calls++; return json({}); }, memoryCache(), initial);
  for (const config of [{ baseUrl: '', projectId: 0, branch: '' }, { baseUrl: 'https://gitlab.fixture.invalid', projectId: 0, branch: 'collaboration' }, { baseUrl: 'https://gitlab.fixture.invalid', projectId: 9001, branch: '../master' }]) await assert.rejects(login.connect(await credential(), config.baseUrl, 'isolated-test', config.branch, config.projectId));
  assert.equal(calls, 0); assert.equal(login.snapshot().target, null); assert.equal(login.snapshot().connected, false);
});

test('模拟：缺分支登录失败清除身份，不创建分支或空间、不回退', async () => {
  const server = gitlabFixture(initial(), 'isolated-test', 'collaboration'), cache = memoryCache();
  server.missingBranch = true;
  const login = new api.SessionLogin(server.fetch, cache, initial);
  await assert.rejects(login.connect(await credential(), server.config.baseUrl, 'isolated-test', server.config.branch, server.config.projectId), error => error.code === 'missing-branch');
  assert.equal(login.snapshot().connected, false); assert.equal(login.snapshot().user, null);
  assert(server.calls.every(call => call.method === 'GET' || call.method === 'HEAD'));
  server.missingBranch = false;
  const sync = await login.connect(await credential(), server.config.baseUrl, 'isolated-test', server.config.branch, server.config.projectId);
  await sync.pull(); assert.equal(sync.snapshot().status, 'synced'); assert.equal(server.commits, 0);
  assert(!JSON.stringify([cache.values, login.snapshot()]).includes(await credential()));
  login.disconnect();
});

test('模拟：账号身份或项目不匹配、403和404均不产生远端写入', async () => {
  for (const condition of ['identity', 'project', 'deny', 'hidden']) {
    const server = gitlabFixture(initial(), 'isolated-test', 'collaboration');
    if (condition === 'deny') server.deny = 403;
    if (condition === 'hidden') server.hidden = true;
    const fetch = async (address, init) => condition === 'identity' && new URL(address).pathname === '/api/v4/user' ? json({}) : condition === 'project' && new URL(address).pathname === '/api/v4/projects/9001' ? json({ id: 9002 }) : server.fetch(address, init);
    const login = new api.SessionLogin(fetch, memoryCache(), initial);
    await assert.rejects(login.connect(await credential(), server.config.baseUrl, 'isolated-test', server.config.branch, server.config.projectId));
    assert.equal(login.snapshot().connected, false); assert.equal(server.commits, 0);
  }
});

test('模拟：可选预设 origin 精确匹配，HTTP 相似域和端口不能泄漏凭据', async () => {
  let calls = 0;
  const config = { baseUrl: api.AUTHORIZED_HTTP_ORIGIN, projectId: 9001, branch: 'collaboration' };
  const login = new api.SessionLogin(async () => { calls++; return json({}); }, memoryCache(), initial, config);
  for (const origin of [config.baseUrl + ':8080', 'http://newgit.d5techs.com.cn.evil.invalid', 'https://other.fixture.invalid']) await assert.rejects(login.connect(await credential(), origin, 'isolated-test'));
  assert.equal(calls, 0);
});

test('模拟：切分支隔离草稿并停止旧自动上传，新分支编辑自动同步', async () => {
  const red = gitlabFixture(initial(), 'isolated-test', 'feature/red'), blue = gitlabFixture(initial(), 'isolated-test', 'feature/blue');
  let selected = red;
  const fetch = async (address, init = {}) => {
    const url = new URL(address), branch = init.body ? JSON.parse(init.body).branch : url.searchParams.get('ref');
    if (branch === blue.config.branch || url.pathname.endsWith('feature%2Fblue')) selected = blue;
    if (branch === red.config.branch || url.pathname.endsWith('feature%2Fred')) selected = red;
    return selected.fetch(address, init);
  };
  const cache = memoryCache(), login = new api.SessionLogin(fetch, cache, initial, red.config);
  const first = await login.connect('synthetic-red', red.config.baseUrl, 'isolated-test'); await first.pull();
  const privateDraft = structuredClone(first.snapshot().draft); privateDraft.demands[0].title = 'red private'; await first.stage(privateDraft);
  let now = 0;
  const environment = { visible: () => true, online: () => true, now: () => now, later: () => 0, cancel() {}, listen: () => () => {} };
  const oldAutomatic = new api.AutoSync(first, 'fixture', environment); oldAutomatic.start(); oldAutomatic.stop();
  const second = await login.connect('synthetic-blue', blue.config.baseUrl, 'isolated-test', blue.config.branch); await second.pull();
  assert.notEqual(first.key, second.key); assert.notEqual(second.snapshot().draft.demands[0].title, 'red private');
  const automatic = new api.AutoSync(second, 'fixture', environment); automatic.start();
  const next = structuredClone(second.snapshot().draft); next.demands[0].title = 'blue uploaded'; await second.stage(next); now += 1000; await automatic.tick(); automatic.stop();
  assert.equal(blue.commits, 1); assert.equal(red.commits, 0);
  await oldAutomatic.tick(); assert.equal(red.commits, 0);
  const restored = await login.connect('synthetic-red', red.config.baseUrl, 'isolated-test', red.config.branch);
  assert.equal(restored.snapshot().draft.demands[0].title, 'red private');
  assert(!JSON.stringify(cache.values).includes('synthetic-red'));
});
