import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ bundle: true, write: false, format: 'esm', platform: 'node',
  stdin: { contents: 'export * from "./src/team-sync"; export * from "./src/models/templates"; export * from "./src/host";', resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
});
const models = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const { PIPELINE_STORAGE_KEY: key, TEAM_SPACES_KEY: spacesKey, BACKUP_KEY: backupKey } = models;
const plain = value => JSON.parse(JSON.stringify(value));
const fixture = (name = '团队甲') => {
  const state = models.createInitialPipelineState();
  state.board.name = name;
  // 2026-10-21 起产品行为是「初始没有星轨」；同步类用例仍需星轨作夹具，故显式注入。
  state.demands = [plain(models.defaultDemand), plain(models.defaultBugDemand)];
  state.selectedDemandId = state.demands[0].id;
  return plain(models.sanitizePipelineState(state));
};
const packageText = spaces => JSON.stringify({ schema: models.TEAM_SCHEMA, version: 1, exported_at: '2026-10-14T08:00:00Z', app_version: '1.4.0', spaces });
function storage(initial = {}, fail = () => false) {
  const values = { ...initial }, writes = [];
  return { values, writes, getItem: name => values[name] ?? null,
    async setItems(patch) {
      writes.push(plain(patch));
      if (fail(patch)) throw new Error('QuotaExceededError');
      for (const [name, value] of Object.entries(patch)) {
        if (value === null) delete values[name]; else values[name] = value;
      }
    },
  };
}
test('§1 导出真实 v4 单看板及旁键空间，先 sanitize，结构和计数一致', () => {
  const state = fixture();
  state.demands[0].customTransitions = [null, { fromNode: 'H1', event: 'done', toNode: 'H2' }];
  state.selectedDemandId = '不存在';
  state.updated_at = '2026-10-14T08:00:00Z';
  const stored = storage({ [key]: JSON.stringify(state), [spacesKey]: JSON.stringify({ activeSpace: '团队甲', spaces: { 团队乙: { state: fixture('团队乙') } } }) });
  const before = plain(stored.values);
  const exported = models.createTeamExport(stored, '1.4.0', new Date(2026, 9, 14, 16, 23));
  assert.equal(exported.fileName, 'starmap-export-20261014-1623.json');
  assert.deepEqual(Object.keys(exported.data), ['schema', 'version', 'exported_at', 'app_version', 'spaces']);
  assert.equal(exported.data.schema, 'beings:star-map:team-export');
  assert.equal(exported.data.version, 1);
  assert.equal(exported.data.app_version, '1.4.0');
  assert.equal(exported.data.spaces.团队甲.updated_at, state.updated_at);
  assert.deepEqual(plain(exported.data.spaces.团队甲.state), plain(models.sanitizePipelineState(state)));
  assert.equal(exported.demandCount, 4);
  assert.deepEqual(stored.values, before);
});
test('§2 全新本地导入两个空间，v4 仍为单个原结构；可切换和再次导出', async () => {
  const stored = storage();
  const team = models.parseTeamPackage(packageText({ 团队甲: { state: fixture() }, 团队乙: { state: fixture('团队乙'), updated_at: '2026-10-14T08:00:00Z' } }));
  const result = await models.applyTeamImport(stored, team, { 团队甲: 'replace', 团队乙: 'replace' });
  assert.equal(result.report.added, 2);
  assert.deepEqual(JSON.parse(stored.values[key]), fixture());
  assert.deepEqual(Object.keys(JSON.parse(stored.values[key])), ['schemaVersion', 'board', 'selectedDemandId', 'demands']);
  assert.deepEqual(Object.keys(models.readTeamSpaces(stored).spaces), ['团队乙', '团队甲']);
  await models.switchTeamSpace(stored, '团队乙');
  assert.deepEqual(JSON.parse(stored.values[key]), fixture('团队乙'));
  assert.equal(models.createTeamExport(stored, '1.4.0').data.spaces.团队乙.updated_at, '2026-10-14T08:00:00Z');
  await models.restoreImportBackup(stored);
  assert.equal(stored.getItem(key), null);
  assert.equal(stored.getItem(spacesKey), null);
});
for (const choice of ['keep', 'replace', 'merge']) {
  test('§2 同名空间三选项：' + choice, async () => {
    const local = fixture(), incoming = fixture();
    incoming.demands[0].title = '导入内容';
    incoming.demands.push({ ...plain(incoming.demands[0]), id: '导入独有' });
    const stored = storage({ [key]: JSON.stringify(local), other: '原字节' });
    const before = plain(stored.values);
    const result = await models.applyTeamImport(stored, models.parseTeamPackage(packageText({ 团队甲: { state: incoming } })), { 团队甲: choice });
    if (choice === 'keep') {
      assert.equal(result.applied, false); assert.equal(result.report.kept, 1);
      assert.deepEqual(stored.values, before); assert.equal(stored.writes.length, 0);
    } else {
      assert.equal(result.report[choice === 'replace' ? 'replaced' : 'merged'], 1);
      assert.deepEqual(JSON.parse(stored.values[key]), plain(models.sanitizePipelineState(incoming)));
      assert.equal(stored.values.other, '原字节');
    }
  });
}
test('§3 demand id 并集；新者整体覆盖，缺失、相同和非法时间戳导入胜，冲突逐 id 记录', async () => {
  const local = fixture(), incoming = fixture();
  const times = [
    ['本地较新', '2026-10-14T09:00:00Z', '2026-10-13T09:00:00Z', 'local'],
    ['导入较新', '2026-10-13T09:00:00Z', '2026-10-14T09:00:00Z', 'import'],
    ['相同', '2026-10-14T09:00:00Z', '2026-10-14T09:00:00Z', 'import'],
    ['缺本地', undefined, '2026-10-14T09:00:00Z', 'import'],
    ['缺导入', '2026-10-14T09:00:00Z', undefined, 'import'],
    ['均缺失', undefined, undefined, 'import'],
    ['非法时间', '无效', '2026-10-14T09:00:00Z', 'import'],
  ];
  local.demands = times.map(([id, updated_at]) => ({ ...fixture().demands[0], id, title: '本地', summary: '本地摘要', updated_at }));
  incoming.demands = times.map(([id, , updated_at]) => ({ ...fixture().demands[0], id, title: '导入', summary: '导入摘要', updated_at, customNodes: [{ ...models.lightPipeline.nodes[0], id: '新节点' }] }));
  local.demands.push({ ...fixture().demands[0], id: '本地独有' });
  incoming.demands.push({ ...fixture().demands[0], id: '导入独有' });
  local.selectedDemandId = '本地独有';
  const stored = storage({ [key]: JSON.stringify(local) });
  const result = await models.applyTeamImport(stored, models.parseTeamPackage(packageText({ 团队甲: { state: incoming } })), { 团队甲: 'merge' });
  const merged = JSON.parse(stored.values[key]);
  assert.deepEqual(merged.demands.map(demand => demand.id), [...times.map(([id]) => id), '本地独有', '导入独有']);
  assert.equal(merged.selectedDemandId, '本地独有');
  for (const [id, , , winner] of times) {
    const chosen = (winner === 'local' ? local : incoming).demands.find(demand => demand.id === id);
    assert.deepEqual(merged.demands.find(demand => demand.id === id), plain(models.sanitizePipelineState({ ...fixture(), demands: [chosen] })).demands[0]);
    const conflict = result.report.conflicts.find(item => item.id === id);
    assert.equal(conflict.winner, winner); assert.equal(conflict.before.title, '本地');
    assert.equal(conflict.after.title, winner === 'local' ? '本地' : '导入');
  }
  assert.equal(result.report.conflicts.length, times.length);
  const inactive = storage({ [key]: JSON.stringify(fixture('当前空间')), [spacesKey]: JSON.stringify({ activeSpace: '当前空间', spaces: { 团队甲: { state: local } } }) });
  const inactiveResult = await models.applyTeamImport(inactive, models.parseTeamPackage(packageText({ 团队甲: { state: incoming } })), { 团队甲: 'merge' });
  assert.deepEqual(inactiveResult.report.conflicts.map(item => item.winner), times.map(([, , , winner]) => winner));
  assert.deepEqual(JSON.parse(inactive.values[key]), fixture('当前空间'));
  assert.deepEqual(plain(models.readTeamSpaces(inactive).spaces.团队甲.state), merged);
});
test('§2 坏包、非数字 version 和非对象 spaces：具体错误且全存储逐字节不变', () => {
  const stored = storage({ [key]: JSON.stringify(fixture()), [backupKey]: '已有备份', other: '保留字节' });
  const before = JSON.stringify(stored.values);
  for (const [text, error] of [
    ['{bad', /JSON 无法解析/],
    [JSON.stringify({ schema: 'other', version: 1, spaces: {} }), /schema 不符/],
    [JSON.stringify({ schema: models.TEAM_SCHEMA, version: 2, spaces: null }), /来自更新的版本，请先升级插件/],
    [JSON.stringify({ schema: models.TEAM_SCHEMA, version: '1', spaces: {} }), /version 必须为数字/],
    [JSON.stringify({ schema: models.TEAM_SCHEMA, version: 1, spaces: [] }), /spaces 必须为对象/],
  ]) { assert.throws(() => models.parseTeamPackage(text), error); assert.equal(JSON.stringify(stored.values), before); }
  assert.equal(stored.writes.length, 0);
});
test('§2 无效空间逐个剔除不拖垮整包；全无效不写入', async () => {
  const stored = storage({ [key]: JSON.stringify(fixture()) });
  const team = models.parseTeamPackage(packageText({ 有效: { state: fixture('有效') }, 空值: null, 非数组: { state: { ...fixture(), demands: {} } }, 错版本: { state: { ...fixture(), schemaVersion: 5 } } }));
  assert.equal(team.rejected.length, 3);
  assert(team.rejected.every(item => item.reason));
  const result = await models.applyTeamImport(stored, team, { 有效: 'replace' });
  assert.equal(result.report.added, 1); assert.equal(result.report.rejected.length, 3);
  const before = JSON.stringify(stored.values), writeCount = stored.writes.length;
  const allBad = models.parseTeamPackage(packageText({ 坏空间: null }));
  assert.equal((await models.applyTeamImport(stored, allBad, {})).applied, false);
  assert.equal(JSON.stringify(stored.values), before); assert.equal(stored.writes.length, writeCount);
});
test('§4 应用前先独立备份；恢复 v4 与旁键全部空间 deep-equal；保留最近备份', async () => {
  const initial = { [key]: JSON.stringify(fixture()), [spacesKey]: JSON.stringify({ activeSpace: '团队甲', spaces: { 团队乙: { state: fixture('团队乙') } } }), other: '不动' };
  const stored = storage(initial);
  const incoming = fixture(); incoming.demands[0].title = '替换内容';
  const team = models.parseTeamPackage(packageText({ 团队甲: { state: incoming }, 团队丙: { state: fixture('团队丙') } }));
  await models.applyTeamImport(stored, team, { 团队甲: 'replace', 团队丙: 'replace' });
  assert.deepEqual(Object.keys(stored.writes[0]), [backupKey]);
  const backup = JSON.parse(stored.values[backupKey]);
  assert(Number.isFinite(Date.parse(backup.backed_up_at)));
  assert.deepEqual(backup.data, { [key]: initial[key], [spacesKey]: initial[spacesKey] });
  assert.deepEqual(Object.keys(stored.writes[1]), [key, spacesKey]);
  await models.restoreImportBackup(stored);
  assert.deepEqual(JSON.parse(stored.values[key]), JSON.parse(initial[key]));
  assert.deepEqual(JSON.parse(stored.values[spacesKey]), JSON.parse(initial[spacesKey]));
  assert.equal(stored.values.other, initial.other); assert.equal(stored.values[backupKey], JSON.stringify(backup));
  await models.applyTeamImport(stored, team, { 团队甲: 'replace', 团队丙: 'replace' });
  assert.equal(Object.keys(stored.values).filter(name => name === backupKey).length, 1);
});
test('§4 备份失败中止，无应用写入；应用失败仍能恢复；坏备份无副作用', async () => {
  const team = models.parseTeamPackage(packageText({ 团队甲: { state: fixture() } }));
  const stored = storage({ [key]: JSON.stringify(fixture()), [backupKey]: '旧备份' }, patch => backupKey in patch);
  const before = JSON.stringify(stored.values);
  await assert.rejects(models.applyTeamImport(stored, team, { 团队甲: 'replace' }), /备份写入失败.*未应用团队包/);
  assert.equal(JSON.stringify(stored.values), before); assert.equal(stored.writes.length, 1);
  const failedApply = storage({ [key]: JSON.stringify(fixture()) }, patch => key in patch);
  await assert.rejects(models.applyTeamImport(failedApply, team, { 团队甲: 'replace' }), /应用失败.*备份已保留/);
  assert.equal(failedApply.getItem(key), JSON.stringify(fixture())); assert(failedApply.getItem(backupKey));
  await assert.rejects(models.restoreImportBackup(stored), /JSON 无法解析/);
  assert.equal(JSON.stringify(stored.values), before);
});
test('宿主真实存储适配：排空旧保存，再等备份成功；异步拒绝不污染内存', async () => {
  const persisted = { [key]: JSON.stringify(fixture()) }, events = [];
  globalThis.document = { getElementById: () => null };
  globalThis.window = { grove: { loadData: async () => persisted, updateData: async patch => {
    events.push(Object.keys(patch));
    await new Promise(resolve => setTimeout(resolve, 5));
    if (backupKey in patch) throw new Error('QuotaExceededError');
    Object.assign(persisted, patch);
  } } };
  await models.initializeStorage();
  models.pluginStorage.setItem('旧保存', '应先完成');
  const team = models.parseTeamPackage(packageText({ 团队甲: { state: fixture() } }));
  await assert.rejects(models.applyTeamImport(models.pluginStorage, team, { 团队甲: 'replace' }), /备份写入失败/);
  assert.deepEqual(events, [['旧保存'], [backupKey]]);
  assert.equal(models.pluginStorage.getItem(backupKey), null); assert.equal(persisted[backupKey], undefined);
  assert.equal(models.pluginStorage.getItem(key), persisted[key]);
});
