import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { gitlabFixture, memoryCache } from './network-fixture.mjs';

const compiled = await build({ bundle: true, write: false, platform: 'node', format: 'esm', stdin: { contents: 'export * from "./src/host-data-writer"; export * from "./src/sync"; export * from "./src/storage"; export * from "./src/models/templates";', resolveDir: fileURLToPath(new URL('../', import.meta.url)) } });
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const settle = async () => { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)); };

test('本机存储：160 次快速编辑合并为一次宿主写入，最后值和删除值保留', async () => {
  const timers = [], writes = [];
  const write = api.createHostDataWriter(async patch => { writes.push(patch); }, callback => timers.push(callback));
  const promises = Array.from({ length: 160 }, (_, index) => write({ draft: String(index), removed: null }));
  assert.equal(timers.length, 1); assert.equal(writes.length, 0);
  timers.shift()(); await Promise.all(promises);
  assert.deepEqual(writes, [{ draft: '159', removed: null }]);
});
test('本机存储：在途写入后另开一批，账号键隔离且请求不重叠', async () => {
  const timers = [], writes = []; let release, active = 0, maximum = 0;
  const hold = new Promise(resolve => { release = resolve; });
  const write = api.createHostDataWriter(async patch => { maximum = Math.max(maximum, ++active); writes.push(patch); if (writes.length === 1) await hold; active--; }, callback => timers.push(callback));
  const first = write({ 'account:A': 'one' }); timers.shift()();
  const second = write({ 'account:B': 'two' }), third = write({ 'account:A': 'three' });
  assert.equal(timers.length, 0); release(); await first; await settle();
  timers.shift()(); await Promise.all([second, third]);
  assert.equal(maximum, 1); assert.deepEqual(writes, [{ 'account:A': 'one' }, { 'account:B': 'two', 'account:A': 'three' }]);
});
test('本机存储：失败如实拒绝，不自动重试权限错误；后续明确保存可恢复', async () => {
  const timers = []; let attempts = 0;
  const write = api.createHostDataWriter(async () => { if (++attempts === 1) throw new Error('permission refused'); }, callback => timers.push(callback));
  const failed = assert.rejects(write({ draft: 'keep in page' }), /permission refused/);
  timers.shift()(); await failed; assert.equal(timers.length, 0); assert.equal(attempts, 1);
  const recovered = write({ draft: 'retry after restoring storage' }); timers.shift()(); await recovered; assert.equal(attempts, 2);
});
test('联网日志：在途缓存写期间的快速草稿合并，不回写过时队列，checkpoint 等待最新值', async () => {
  const initial = api.createInitialPipelineState(), backend = gitlabFixture(initial), cache = memoryCache();
  let release, writes = 0;
  const hold = new Promise(resolve => { release = resolve; });
  const persist = cache.setItems.bind(cache);
  cache.setItems = async patch => { writes++; if (writes === 1) await hold; await persist(patch); };
  const sync = new api.TeamSync(api.createTeamStorage(backend.fetch, async () => 'fixture-only', backend.config), cache, 'isolated-test', initial, 'A');
  const promises = [];
  for (let index = 0; index < 160; index++) { const state = structuredClone(initial); state.demands[0].title = 'latest ' + index; promises.push(sync.stage(state)); if (index === 0) await settle(); }
  const checkpoint = sync.checkpoint(); release(); await Promise.all([...promises, checkpoint]);
  assert.equal(writes, 2); assert.equal(JSON.parse(cache.values[sync.key]).draft.demands[0].title, 'latest 159');
  assert.equal(backend.commits, 0);
});
