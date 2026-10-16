import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { gitlabFixture, memoryCache } from './network-fixture.mjs';

const compiled = await build({ bundle: true, write: false, format: 'esm', platform: 'node', stdin: { contents: 'export * from "./src/activity"; export * from "./src/reminders"; export * from "./src/models/templates"; export * from "./src/sync-merge"; export * from "./src/gitlab-client"; export * from "./src/storage"; export * from "./src/sync";', resolveDir: fileURLToPath(new URL('../', import.meta.url)) } });
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const start = Date.parse('2026-10-15T08:00:00Z');
const time = seconds => new Date(start + seconds * 1000).toISOString();
const initial = () => {
  const state = api.createInitialPipelineState();
  const demand = api.createDemand('隔离测试星轨', 'test', api.blankPipeline);
  demand.customNodes = ['first', 'second'].map(id => ({ id, kind: 'node', title: id, status: 'pending', stationId: 'stage', owner: '角色文字', owner_group: 'test', description: '测试说明', trigger: ['人工'], responsibleBeingIds: id === 'first' ? ['t_alice', 't_bob'] : ['t_bob'] }));
  state.demands = [demand]; state.selectedDemandId = demand.id; return state;
};
const nodes = state => api.demandNodes(api.blankPipeline, state.demands[0]);
const summary = (state, id = 'first', seconds = 60) => api.nodeActivity(state.demands[0], nodes(state).find(node => node.id === id), start + seconds * 1000);
const change = (state, statuses, seconds) => {
  const next = structuredClone(state); Object.assign(next.demands[0].nodeStates, statuses);
  return api.recordActivity(state, next, time(seconds));
};
const directory = () => api.verifyDirectory({ entries: [{ town_id: 't_alice', display_name: 'Alice' }, { town_id: 't_bob', display_name: 'Bob' }], count: 2 }, start);
const activeState = () => change(initial(), { first: 'running', second: 'waiting_human' }, 0);
const plan = state => api.reminderPlan(state.demands[0], nodes(state), directory(), start);

test('旧数据不补历史；就绪和待开始不是已进入节点', () => {
  const state = initial(); state.demands[0].nodeStates = { first: 'running', second: 'done' };
  const normalized = api.sanitizePipelineState(state);
  assert.equal(normalized.demands[0].activityEvents, undefined);
  assert.equal(summary(normalized).enteredAt, null); assert.equal(summary(normalized).durationMs, null);
  assert.equal(api.currentNodes(nodes(normalized)).length, 1);
  assert.equal(api.currentNodes(nodes(initial())).length, 0);
  assert.equal(api.stageDuration(normalized.demands[0], nodes(normalized), 'stage', start), null);
});
test('真实操作进出，等待/阻塞/失败连续计时，同值不生成事件，重新进入单独记录', () => {
  let state = change(initial(), { first: 'running' }, 0);
  state = change(state, { first: 'waiting_human' }, 10); state = change(state, { first: 'blocked' }, 15);
  state = change(state, { first: 'failed' }, 20); state = change(state, { first: 'failed' }, 25);
  state = change(state, { first: 'done' }, 30);
  assert.equal(state.demands[0].activityEvents.length, 5);
  assert.equal(summary(state).enteredAt, time(0)); assert.equal(summary(state).exitedAt, time(30)); assert.equal(summary(state).durationMs, 30000);
  state = change(state, { first: 'running' }, 40); state = change(state, { first: 'skipped' }, 50);
  assert.equal(summary(state).intervals.length, 2); assert.equal(summary(state).durationMs, 40000);
});
test('旧运行节点完成只记录真实退出；旧完成重开不声称历史累计完整', () => {
  const old = initial(); old.demands[0].nodeStates.first = 'running';
  const closed = change(old, { first: 'done' }, 30);
  assert.equal(summary(closed).enteredAt, null); assert.equal(summary(closed).exitedAt, time(30)); assert.equal(summary(closed).durationMs, null);
  const reopened = change(closed, { first: 'running' }, 40);
  assert.equal(summary(reopened).enteredAt, time(40)); assert.equal(summary(reopened).durationMs, null);
  const legacyDone = initial(); legacyDone.demands[0].nodeStates.first = 'done';
  assert.equal(summary(change(legacyDone, { first: 'running' }, 40)).durationMs, null);
});
test('并行节点阶段耗时取区间并集，不相加；当前节点保留全部并行节点', () => {
  let state = change(initial(), { first: 'running' }, 0); state = change(state, { second: 'running' }, 10);
  assert.equal(api.currentNodes(nodes(state)).length, 2);
  state = change(state, { first: 'done' }, 20); state = change(state, { second: 'done' }, 30);
  assert.equal(api.stageDuration(state.demands[0], nodes(state), 'stage', start + 60000), 30000);
});
test('撤销保留已发生记录，记录此刻重新进入；移站按实际操作拆分区间', () => {
  const running = change(initial(), { first: 'running' }, 0); const done = change(running, { first: 'done' }, 10);
  const undo = api.recordActivity(done, structuredClone(running), time(20));
  assert.equal(undo.demands[0].activityEvents.length, 3); assert.equal(summary(undo).enteredAt, time(20)); assert.equal(summary(undo).durationMs, 50000);
  const moved = structuredClone(undo); moved.demands[0].nodeOverrides.first = { stationId: 'other' };
  const result = api.recordActivity(undo, moved, time(30));
  assert.equal(summary(result).enteredAt, time(20));
  assert.equal(api.stageDuration(result.demands[0], nodes(result), 'stage', start + 60000), 20000);
  assert.equal(api.stageDuration(result.demands[0], nodes(result), 'other', start + 60000), 30000);
});
test('删除正在运行的普通节点结束计时，保留历史区间；恢复记录实际重进时间', () => {
  const state = change(initial(), { first: 'running' }, 0); const next = structuredClone(state); next.demands[0].deletedNodeIds.push('first');
  const removed = api.recordActivity(state, next, time(10));
  assert.equal(api.stageDuration(removed.demands[0], nodes(removed), 'stage', start + 60000), 10000);
  const restored = api.recordActivity(removed, state, time(20));
  assert.equal(summary(restored).enteredAt, time(20)); assert.equal(summary(restored).durationMs, 50000);
});
test('设备时钟倒退、缺失链或并发同节点分叉不产生伪耗时', () => {
  const base = initial(); const first = change(base, { first: 'running' }, 20);
  assert.match(summary(first, 'first', 10).issue, /时钟/);
  assert.match(summary(change(first, { first: 'done' }, 10)).issue, /倒退/);
  const second = change(base, { first: 'running' }, 21);
  const merged = api.mergeSpace(base, first, second);
  assert.equal(merged.conflicts.length, 0); assert.match(summary(merged.state).issue, /分叉/); assert.equal(summary(merged.state).durationMs, null);
});
test('两个隔离模拟客户端并发节点记录不丢失；联网验证不是实际双用户联测', async () => {
  const base = initial(); const server = gitlabFixture(base, 'activity-isolated');
  const session = () => new api.TeamSync(api.createTeamStorage(server.fetch, async () => 'fixture-only', server.config), memoryCache(), 'activity-isolated', base);
  const first = session(); const second = session(); await first.pull(); await second.pull();
  await first.stage(change(first.snapshot().draft, { first: 'running' }, 0));
  await second.stage(change(second.snapshot().draft, { second: 'running' }, 10));
  await first.push('fixture A'); await second.pull(); assert.equal(second.snapshot().conflicts.length, 0);
  await second.push('fixture B'); await first.pull();
  assert.equal(first.snapshot().draft.demands[0].activityEvents.length, 2);
  assert.equal(api.currentNodes(nodes(first.snapshot().draft)).length, 2);
  assert.equal(api.validateState(first.snapshot().draft).demands[0].customNodes[0].responsibleBeingIds.length, 2);
});
test('时间字段格式或重复事件 ID 错误拒绝同步，不静默修剪', () => {
  const state = change(initial(), { first: 'running' }, 0);
  state.demands[0].activityEvents.push({ ...state.demands[0].activityEvents[0] });
  assert.throws(() => api.validateState(state), /时间记录无效/);
});
test('地址只按明确 Town ID 精确核验，覆盖并行负责人并对同人跨节点去重', () => {
  const state = activeState(); const prepared = plan(state);
  assert.equal(prepared.blocked.length, 0); assert.equal(prepared.recipients.length, 2);
  assert.deepEqual(prepared.recipients.find(recipient => recipient.id === 't_bob').nodeIds, ['first', 'second']);
  state.demands[0].customNodes[0].responsibleBeingIds = ['https://example.com', 't_missing'];
  assert.equal(plan(state).blocked.length, 2);
  assert(api.reminderPlan(state.demands[0], nodes(state), directory(), start + api.REMINDER_WINDOW_MS).blocked.length);
  assert.throws(() => api.verifyDirectory({ entries: [{ town_id: 't_a' }, { town_id: 't_a' }] }), /重复/);
  assert.throws(() => api.verifyDirectory({ entries: [], count: 2 }), /不完整/);
});
test('模拟逐收件人回执持久化；双击、重载及五分钟内重复均阻止', async () => {
  const cache = memoryCache(); let deliveries = 0; let release;
  const service = new api.SimulatedReminderService(cache, async () => { deliveries++; await new Promise(resolve => { release = resolve; }); return true; }, () => start);
  const sending = service.run(plan(activeState()));
  await new Promise(resolve => setImmediate(resolve)); await assert.rejects(() => service.run(plan(activeState())), /正在处理/);
  release(); await new Promise(resolve => setImmediate(resolve)); release();
  const attempt = await sending; assert.equal(deliveries, 2); assert(attempt.results.every(result => result.status === 'simulated-delivered'));
  const repeatPlan = { ...plan(activeState()), key: attempt.key };
  await assert.rejects(() => new api.SimulatedReminderService(cache, async () => { throw new Error('不能调用'); }, () => start).run(repeatPlan), /五分钟/);
});
test('重试仅模拟失败收件人，不重复成功者；状态或负责人变化生成新操作', async () => {
  const state = activeState(); const prepared = plan(state); const cache = memoryCache(); const calls = [];
  const service = new api.SimulatedReminderService(cache, async recipient => { calls.push(recipient.id); return recipient.id !== 't_bob' || calls.length > 2; }, () => start);
  const first = await service.run(prepared); assert.equal(first.results[1].status, 'failed');
  const retry = await service.run(prepared, true); assert(retry.results.every(result => result.status === 'simulated-delivered'));
  assert.deepEqual(calls, ['t_alice', 't_bob', 't_bob']);
  assert.notEqual(plan(change(state, { first: 'done' }, 10)).key, prepared.key);
  await assert.rejects(() => service.run(prepared, true), /没有可重试/);
});
test('缓存写失败、未核验或未确认的 pending 不发送、不自动重放', async () => {
  const cache = memoryCache(); let calls = 0;
  const blockedCache = { getItem: () => null, setItems: async () => { throw new Error('磁盘失败'); } };
  await assert.rejects(() => new api.SimulatedReminderService(blockedCache, async () => { calls++; return true; }).run(plan(activeState())), /磁盘失败/);
  const state = activeState(); const prepared = plan(state);
  await assert.rejects(() => new api.SimulatedReminderService(cache).run({ ...prepared, blocked: ['地址未核验'] }), /核验/);
  await cache.setItems({ [api.REMINDER_STORAGE_KEY]: JSON.stringify([{ id: 'pending', key: prepared.key, at: start, results: [{ recipientId: 't_bob', status: 'pending', at: start }] }]) });
  await assert.rejects(() => new api.SimulatedReminderService(cache, async () => { calls++; return true; }).run(prepared), /未确认/); assert.equal(calls, 0);
});
