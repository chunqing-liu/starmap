import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { memoryCache } from './network-fixture.mjs';

const compiled = await build({ bundle: true, write: false, platform: 'node', format: 'esm', stdin: { contents: 'export * from "./src/network-auth"; export * from "./src/sync"; export * from "./src/auto-sync"; export * from "./src/models/templates"; export * from "./src/team-space-picker";', resolveDir: fileURLToPath(new URL('../', import.meta.url)) } });
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const initial = () => { const s = structuredClone(api.createInitialPipelineState()); s.demands = [structuredClone(api.defaultDemand), structuredClone(api.defaultBugDemand)]; s.selectedDemandId = s.demands[0].id; return s; };
async function session(cache = memoryCache()) {
  const calls = [];
  const hostFetch = async address => {
    const url = new URL(address); calls.push(url);
    assert.equal(url.origin, 'https://gitlab.fixture.invalid');
    const value = url.pathname === '/api/v4/user' ? { id: 101, username: 'unit-user' } : url.pathname.includes('/branches/') ? { name: 'collaboration' } : { id: 9001 };
    return new Response(JSON.stringify(value));
  };
  const login = new api.SessionLogin(hostFetch, cache, initial);
  const sync = await login.connect('synthetic-unit-credential', 'https://gitlab.fixture.invalid', 'existing', 'collaboration', 9001);
  return { login, sync, cache, calls };
}
async function editTitle(sync, title) {
  const draft = structuredClone(sync.snapshot().draft); draft.demands[0].title = title;
  await sync.stage(draft); return draft;
}

const directoryMarkup = (overrides = {}) => renderToStaticMarkup(api.TeamSpacePickerView({ space: 'shared', names: null, busy: false, syncBusy: false, error: '', onSelect: () => {}, onRefresh: () => {}, ...overrides }));

test('界面静态渲染：成功空目录提示和禁用选择，不误显示为已同步', () => {
  const html = directoryMarkup({ names: [] });
  assert.match(html, /role="status">此分支暂无共享空间/);
  assert.match(html, /select[^>]*aria-label="选择共享空间"[^>]*disabled/);
  assert.match(html, /shared（当前空间，目录中未列出）/);
  assert(!html.includes('已同步')); assert(!html.includes('role="alert"'));
});

test('界面静态渲染：读取失败显示错误而非空目录，旧目录明确提示过期', () => {
  const message = 'GitLab 拒绝访问或写入；请核验权限。';
  const html = directoryMarkup({ error: message });
  assert.match(html, /role="alert"/); assert(html.includes(message)); assert(!html.includes('暂无共享空间'));
  const stale = directoryMarkup({ names: ['shared', 'other'], error: message });
  assert(stale.includes('目录可能已过期')); assert(stale.includes('value="other"'));
  assert(!stale.includes('暂无共享空间'));
});

test('界面静态渲染：已有空间可选择，加载或同步时禁止切换且不显示假空态', () => {
  const ready = directoryMarkup({ names: ['other', 'shared'] });
  assert.match(ready, /option value="shared" selected=""/); assert(!ready.includes('disabled'));
  const loading = directoryMarkup({ busy: true, names: [] });
  assert(loading.includes('正在读取或切换共享空间')); assert(!loading.includes('暂无共享空间'));
  const syncing = directoryMarkup({ syncBusy: true, names: ['other', 'shared'] });
  assert.match(syncing, /select[^>]*disabled/);
});

test('单元：非法空间不销毁原会话，原草稿仍可保存', async () => {
  const { login, sync, cache, calls } = await session();
  const count = calls.length;
  await assert.rejects(login.switchSpace('../other'), error => error.code === 'format');
  await editTitle(sync, '原会话仍可编辑');
  assert.equal(JSON.parse(cache.values[sync.key]).draft.demands[0].title, '原会话仍可编辑');
  assert.equal(await login.switchSpace('existing'), sync);
  assert.equal(calls.length, count);
  login.disconnect();
});

test('单元：目标缓存损坏时保留原会话和草稿，不伪装切换成功', async () => {
  const { login, sync, cache } = await session();
  cache.values[sync.key.replace(':existing:account:', ':broken:account:')] = '{broken';
  await assert.rejects(login.switchSpace('broken'), error => error.code === 'format');
  await editTitle(sync, '损坏目标不影响当前草稿');
  assert.equal(JSON.parse(cache.values[sync.key]).draft.demands[0].title, '损坏目标不影响当前草稿');
  assert.equal(await login.switchSpace('existing'), sync);
  login.disconnect();
});

test('单元：切换仅使用同一授权目标，往返恢复空间草稿且不持久化凭据', async () => {
  const { login, sync, cache, calls } = await session();
  await editTitle(sync, '原空间未上传草稿');
  const other = await login.switchSpace('other');
  assert.equal(other.remote.target, sync.remote.target); assert.equal(other.account, sync.account);
  await editTitle(other, '另一空间草稿');
  const restored = await login.switchSpace('existing');
  assert.equal(restored.snapshot().draft.demands[0].title, '原空间未上传草稿');
  assert.equal(calls.length, 3);
  assert(!JSON.stringify(cache.values).includes('synthetic-unit-credential'));
  login.disconnect();
});

test('单元：保存失败或保存途中退出不会激活另一个空间', async () => {
  const first = await session(); first.cache.fail = true;
  await assert.rejects(first.login.switchSpace('other'));
  first.cache.fail = false; await editTitle(first.sync, '保存恢复');
  assert.equal(await first.login.switchSpace('existing'), first.sync); first.login.disconnect();
  const second = await session();
  let release;
  second.cache.setItems = () => new Promise(resolve => { release = resolve; });
  const switching = second.login.switchSpace('other');
  await new Promise(resolve => setImmediate(resolve)); second.login.disconnect(); release();
  await assert.rejects(switching, error => error.code === 'credentials');
  assert.equal(second.login.snapshot().connected, false);
});

test('单元：新增星轨可被独立状态刷新或自动检查发现，选择不改他人选中项', async () => {
  let stored = initial(), revision = 'unit-0', saves = 0;
  const remote = { target: 'unit-shared-state',
    load: async () => ({ state: structuredClone(stored), rev: revision, metaRev: revision }),
    revision: async () => revision, listSpaces: async () => ['shared'],
    save: async (space, state, baseRev) => { assert.equal(space, 'shared'); assert.equal(baseRev, revision); stored = structuredClone(state); revision = 'unit-' + ++saves; return remote.load(); },
  };
  const source = new api.TeamSync(remote, memoryCache(), 'shared', initial(), 'unit-account', true);
  const manual = new api.TeamSync(remote, memoryCache(), 'shared', initial(), 'unit-account', true);
  const automatic = new api.TeamSync(remote, memoryCache(), 'shared', initial(), 'unit-account', true);
  await Promise.all([source.pull(), manual.pull(), automatic.pull()]);
  const selected = manual.snapshot().draft.selectedDemandId;
  const created = api.createDemand('代码测试新增共享星轨', 'Unit', api.blankPipeline);
  const draft = structuredClone(source.snapshot().draft); draft.demands.push(created); draft.selectedDemandId = created.id;
  await source.stage(draft); await source.push('Unit');
  await manual.pull();
  assert(manual.snapshot().draft.demands.some(demand => demand.id === created.id));
  assert.equal(manual.snapshot().draft.selectedDemandId, selected);
  const controller = new api.AutoSync(automatic, 'Unit', { visible: () => true, online: () => true, now: () => 1000, later: () => 0, cancel: () => {}, listen: () => () => {} });
  controller.start(); await controller.tick(); controller.stop();
  assert(automatic.snapshot().draft.demands.some(demand => demand.id === created.id));
  const selection = structuredClone(manual.snapshot().draft); selection.selectedDemandId = created.id; await manual.stage(selection);
  assert.equal(manual.snapshot().dirty, false); assert.equal(saves, 1);
  source.dispose(); manual.dispose(); automatic.dispose();
});
