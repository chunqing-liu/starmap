import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { gitlabFixture, memoryCache } from './network-fixture.mjs';

const compiled = await build({ bundle: true, write: false, format: 'esm', platform: 'node', stdin: { contents: 'export * from "./src/storage"; export * from "./src/sync"; export * from "./src/sync-merge"; export * from "./src/gitlab-client"; export * from "./src/edit-policy"; export * from "./src/models/templates";', resolveDir: fileURLToPath(new URL('../', import.meta.url)) } });
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const initial = () => structuredClone(api.createInitialPipelineState());
const draft = (sync, change) => { const state = structuredClone(sync.snapshot().draft); change(state); return sync.stage(state); };
const session = (server, cache = memoryCache(), state = initial(), credentials = async () => 'isolated-fixture-credential') => new api.TeamSync(api.createTeamStorage(server.fetch, credentials, server.config), cache, 'isolated-test', state);

test('模拟：两个独立客户端拉取/写入一致，私有选择不导致脏数据', async () => {
  const server = gitlabFixture(initial()), first = session(server), second = session(server);
  await first.pull(); await second.pull(); assert.equal(first.snapshot().status, 'synced');
  await draft(first, state => { state.selectedDemandId = state.demands[1].id; state.board.currentUserId = 'local-user'; }); assert.equal(first.dirty, false);
  await draft(first, state => { state.demands[0].title = '甲的真实内容'; }); await first.push('A'); await second.pull();
  assert.equal(second.snapshot().draft.demands[0].title, '甲的真实内容'); assert.equal(first.snapshot().base.rev, second.snapshot().base.rev); assert.equal(second.dirty, false);
});
test('模拟：不同字段并发合并，用户检查后再次推送，不丢任一方', async () => {
  const server = gitlabFixture(initial()), first = session(server), second = session(server); await first.pull(); await second.pull();
  await draft(first, state => { state.demands[0].title = 'A 标题'; }); await draft(second, state => { state.demands[0].summary = 'B 内容'; });
  await first.push('A'); await second.push('B'); assert.equal(server.commits, 1); assert.equal(second.snapshot().status, 'dirty');
  assert.equal(second.snapshot().draft.demands[0].title, 'A 标题'); assert.equal(second.snapshot().draft.demands[0].summary, 'B 内容');
  await second.push('B'); await first.pull(); assert.equal(server.commits, 2); assert(api.sameState(first.snapshot().draft, second.snapshot().draft));
});
test('模拟：同字段冲突不静默覆盖，显式选择后仍重新校验远端', async () => {
  const server = gitlabFixture(initial()), first = session(server), second = session(server); await first.pull(); await second.pull();
  await draft(first, state => { state.demands[0].title = 'A 标题'; }); await draft(second, state => { state.demands[0].title = 'B 标题'; });
  await first.push('A'); await second.push('B'); assert.equal(second.snapshot().status, 'conflict'); assert.equal(server.state().demands[0].title, 'A 标题');
  await assert.rejects(second.resolve({}), /每个冲突/);
  const choices = Object.fromEntries(second.snapshot().conflicts.map(conflict => [conflict.path, 'local'])); await second.resolve(choices);
  await draft(first, state => { state.demands[0].title = 'A 再次修改'; }); await first.push('A'); await second.push('B');
  assert.equal(second.snapshot().status, 'conflict'); assert.equal(server.state().demands[0].title, 'A 再次修改');
});
test('模拟：GET 与 POST 之间发生竞争，服务端 last_commit_id 阻止覆盖', async () => {
  const server = gitlabFixture(initial()), first = session(server); await first.pull(); await draft(first, state => { state.demands[0].title = '本地'; });
  server.beforeCommit = async () => { const other = server.state(); other.demands[0].title = '并发赢家'; server.put(other); };
  await first.push('A'); assert.equal(first.snapshot().status, 'conflict'); assert.equal(server.commits, 0); assert.equal(server.state().demands[0].title, '并发赢家');
});
test('模拟：断网、重开客户端、恢复先拉取后推送，草稿持久化', async () => {
  const server = gitlabFixture(initial()), cache = memoryCache(), first = session(server, cache); await first.pull(); server.offline = true;
  await draft(first, state => { state.demands[0].summary = '离线修改'; }); await first.push('A'); assert.equal(first.snapshot().status, 'offline');
  const restarted = session(server, cache); assert.equal(restarted.snapshot().draft.demands[0].summary, '离线修改');
  server.offline = false; await restarted.pull(); assert.equal(restarted.dirty, true); await restarted.push('A'); assert.equal(restarted.snapshot().status, 'synced');
  assert.equal(server.state().demands[0].summary, '离线修改');
});
test('模拟：写入成功但丢失回执，重启后核验而非重复提交', async () => {
  const server = gitlabFixture(initial()), cache = memoryCache(), first = session(server, cache); await first.pull(); await draft(first, state => { state.demands[0].title = '回执丢失'; }); server.loseReply = true;
  await first.push('A'); assert.equal(first.snapshot().status, 'unknown'); await first.push('A'); assert.equal(server.commits, 1);
  const restarted = session(server, cache); assert.equal(restarted.snapshot().status, 'unknown'); await restarted.pull(); assert.equal(restarted.snapshot().status, 'synced'); assert.equal(restarted.snapshot().pending, null); assert.equal(server.commits, 1);
});
test('模拟：提交期间继续编辑，后续编辑保留为待推送', async () => {
  const server = gitlabFixture(initial()), first = session(server); await first.pull(); await draft(first, state => { state.demands[0].title = '提交内容'; });
  server.beforeCommit = async () => { await draft(first, state => { state.demands[0].summary = '提交期间新增'; }); };
  await first.push('A'); assert.equal(first.dirty, true); assert.equal(first.snapshot().draft.demands[0].summary, '提交期间新增');
  await first.push('A'); assert.equal(server.state().demands[0].summary, '提交期间新增');
});
test('模拟：首次迁移需要拉取和确认，两个创建者不会覆盖对方', async () => {
  const server = gitlabFixture(null), first = session(server), second = session(server);
  await first.push('A', true); assert.equal(server.commits, 0); await first.pull(); await second.pull();
  await first.push('A'); assert.equal(server.commits, 0); await first.push('A', true); assert.equal(server.commits, 1);
  await draft(second, state => { state.demands[0].title = '第二个创建者'; }); await second.push('B', true); assert.equal(server.commits, 1); assert.equal(second.dirty, true);
});
test('模拟：本机存储失败时禁止远端写入，页面草稿仍保留', async () => {
  const server = gitlabFixture(initial()), cache = memoryCache(), first = session(server, cache); await first.pull(); cache.fail = true;
  await assert.rejects(draft(first, state => { state.demands[0].title = '未落盘草稿'; })); await first.push('A');
  assert.equal(server.commits, 0); assert.equal(first.snapshot().draft.demands[0].title, '未落盘草稿'); assert.equal(first.snapshot().storageFailed, true);
});
test('模拟：无凭据不发网络；401/403/私仓404不当作空空间，错误不泄密', async () => {
  const server = gitlabFixture(initial()), noCredential = session(server, memoryCache(), initial(), async () => null); await noCredential.pull(); assert.equal(server.calls.length, 0); assert.match(noCredential.snapshot().message, /尚未登录或会话已失效/);
  for (const status of [401, 403]) { server.deny = status; const client = session(server); await client.pull(); assert.equal(client.snapshot().status, 'error'); assert.equal(client.snapshot().base, null); assert(!JSON.stringify(client.snapshot()).includes('isolated-fixture-credential')); }
  server.deny = 0; server.hidden = true; const client = session(server); await client.pull(); assert.equal(client.snapshot().base, null); assert.match(client.snapshot().message, /404 不能视为空仓/);
});
test('模拟：路径穿越、坏 JSON、重复星轨 id 与删除/编辑冲突', async () => {
  const server = gitlabFixture(initial()), client = new api.GitLabClient(server.fetch, async () => 'isolated-fixture-credential', server.config);
  for (const name of ['../prod', 'main.meta', '中文', 'a/b', '']) await assert.rejects(client.load(name));
  assert.equal(server.calls.length, 0); const duplicate = initial(); duplicate.demands.push(duplicate.demands[0]); assert.throws(() => api.validateState(duplicate), /重复/);
  const malformed = new api.GitLabClient(async () => new Response(JSON.stringify({ encoding: 'base64', content: Buffer.from('invalid json').toString('base64'), last_commit_id: 'bad', commit_id: 'bad' })), async () => 'isolated-fixture-credential', server.config);
  await assert.rejects(malformed.load('isolated-test'), /JSON/);
  const base = initial(), local = structuredClone(base), remote = structuredClone(base); local.demands.shift(); remote.demands[0].title = '对端编辑';
  const merged = api.mergeSpace(base, local, remote); assert.equal(merged.conflicts.length, 1); assert.equal(merged.conflicts[0].localDeleted, true);
});
test('模拟：单方排序保留，双方排序与独立新增的顺序显式选择', () => {
  const base = initial(), local = structuredClone(base), remote = structuredClone(base);
  local.demands[0].title = '本地内容'; remote.demands.reverse();
  const reordered = api.mergeSpace(base, local, remote);
  assert.equal(reordered.conflicts.length, 0); assert.deepEqual(reordered.state.demands.map(demand => demand.id), remote.demands.map(demand => demand.id));
  assert.equal(reordered.state.demands[1].title, '本地内容');
  const first = structuredClone(base), second = structuredClone(base);
  first.demands.push({ ...structuredClone(base.demands[0]), id: 'new-a', title: 'A 新星轨' });
  second.demands.unshift({ ...structuredClone(base.demands[0]), id: 'new-b', title: 'B 新星轨' });
  const result = api.mergeSpace(base, first, second); assert.deepEqual(result.conflicts.map(conflict => conflict.path), ['/demands/$order']);
  const resolved = api.mergeSpace(base, first, second, { '/demands/$order': 'remote' });
  assert.equal(resolved.conflicts.length, 0); assert.deepEqual(resolved.state.demands.map(demand => demand.id), ['new-b', ...base.demands.map(demand => demand.id), 'new-a']);
});
test('模拟：目录过滤元数据；所有闸口防删除，普通节点可编辑', async () => {
  const server = gitlabFixture(initial()), first = session(server); await first.pull(); await draft(first, state => { state.demands[0].title = '目录'; }); await first.push('A');
  assert.deepEqual(await first.remote.listSpaces(), ['isolated-test']); assert.equal(api.deletionProtected({ kind: 'gate', locked: false }), true); assert.equal(api.deletionProtected({ kind: 'node' }), false); assert.equal(api.deletionProtected({ locked: true }), true);
});
test('模拟：空站连线不被重建，缺失历史不伪造时间，未知数据不被静默丢弃', () => {
  const state = initial(); state.demands[0].stationLinks = []; state.demands[1].bug.history = [];
  const clean = api.validateState(state); assert.deepEqual(clean.demands[0].stationLinks, []); assert.deepEqual(clean.demands[1].bug.history, []);
  assert(api.sameState(clean, api.validateState(clean)));
  const future = structuredClone(clean); future.demands[0].futureTiming = { enteredAt: '2026-10-15T01:00:00Z' };
  assert.throws(() => api.validateState(future), /不兼容/);
  const broken = structuredClone(clean); broken.demands[0].customNodes.push(null); assert.throws(() => api.validateState(broken), /集合项/);
});
