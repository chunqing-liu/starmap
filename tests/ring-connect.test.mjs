import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ bundle: true, write: false, format: 'esm', platform: 'node', stdin: { contents: 'export * from "./src/ring-connect";', resolveDir: fileURLToPath(new URL('../', import.meta.url)) } });
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const ring = { id: '29', name: 'Lite 项目组' };
const key = { endpoint: 'http://newgit.d5techs.com.cn', projectId: 730, branch: 'data', space: 'lite', token: 'glpat-abcdefghijklmnopqrst' };
const line = 'STARMAP-KEY:' + JSON.stringify(key);

test('围炉钥匙：正常一行能被读出', () => {
  const found = api.parseRingKeyMessage('【星图共享空间】\n' + line + '\n其它说明', ring);
  assert.deepEqual(found, { ringId: '29', ringName: 'Lite 项目组', ...key });
});
test('围炉钥匙：缺字段、坏地址、坏分支一律不认，不猜', () => {
  const bad = [
    'STARMAP-KEY:' + JSON.stringify({ ...key, token: '' }),
    'STARMAP-KEY:' + JSON.stringify({ ...key, projectId: 0 }),
    'STARMAP-KEY:' + JSON.stringify({ ...key, projectId: 'x' }),
    'STARMAP-KEY:' + JSON.stringify({ ...key, endpoint: 'http://newgit.d5techs.com.cn/sub' }),
    'STARMAP-KEY:' + JSON.stringify({ ...key, endpoint: 'ftp://newgit.d5techs.com.cn' }),
    'STARMAP-KEY:' + JSON.stringify({ ...key, branch: 'data..x' }),
    'STARMAP-KEY:' + JSON.stringify({ ...key, space: '有 空格' }),
    'STARMAP-KEY:{不是 json',
    'STARMAP-KEY:',
    'STARMAP-KEYX' + JSON.stringify(key)
  ];
  for (const text of bad) assert.equal(api.parseRingKeyMessage(text, ring), null, text);
});
test('围炉钥匙：只认行首标记，正文中间提到不算', () => {
  assert.equal(api.parseRingKeyMessage('有人写了 STARMAP-KEY:' + JSON.stringify(key), ring), null);
});
test('围炉钥匙：多条取最新的一条', () => {
  const newer = { ...key, projectId: 731, space: 'lite2' };
  const messages = [
    { message: line, at: '2026-10-19T10:00:00+08:00' },
    { message: '闲聊' },
    { message: 'STARMAP-KEY:' + JSON.stringify(newer), at: '2026-10-19T12:00:00+08:00' }
  ];
  assert.equal(api.latestRingKey(messages, ring).projectId, 731);
  assert.equal(api.latestRingKey([], ring), null);
  assert.equal(api.latestRingKey(null, ring), null);
});
test('自动发现：列出已加入围炉，读到钥匙就给出空间', async () => {
  const seen = [];
  const query = async ({ kind, id }) => {
    seen.push(kind + ':' + (id || ''));
    if (kind === 'firesides') return { ok: true, data: { joined: [{ id: 29, name: 'Lite 项目组' }, { id: 22, name: 'desktop 通路反馈' }], owned: [] } };
    if (id === '29') return { ok: true, data: { messages: [{ message: '大家好' }, { message: line }] } };
    return { ok: true, data: { messages: [{ message: '没有钥匙' }] } };
  };
  const found = await api.discoverRingSpaces(query);
  assert.equal(found.spaces.length, 1);
  assert.equal(found.spaces[0].projectId, 730);
  assert.equal(found.spaces[0].ringName, 'Lite 项目组');
  assert.deepEqual(seen, ['firesides:', 'fireside:29', 'fireside:22']);
});
test('自动发现：读不到围炉列表、读不到消息都不抛错，只给提示', async () => {
  const denied = await api.discoverRingSpaces(async () => ({ ok: false, code: 'auth', message: 'no' }));
  assert.deepEqual(denied.spaces, []);
  assert.match(denied.note, /手动填写/);
  const thrown = await api.discoverRingSpaces(async () => { throw new Error('boom'); });
  assert.equal(thrown.spaces.length, 0);
  const silent = await api.discoverRingSpaces(async ({ kind }) => kind === 'firesides'
    ? { ok: true, data: { joined: [{ id: 29, name: 'Lite 项目组' }], owned: [] } }
    : { ok: false, code: 'forbidden', message: 'no' });
  assert.equal(silent.spaces.length, 0);
  assert.equal(silent.ringsSeen, 0);
  assert.match(silent.note, /手动填写/);
});
test('自动发现：同一个空间在多个围炉里只出现一次', async () => {
  const query = async ({ kind }) => kind === 'firesides'
    ? { ok: true, data: { joined: [{ id: 29, name: 'A' }, { id: 30, name: 'B' }] } }
    : { ok: true, data: { messages: [{ message: line }] } };
  const found = await api.discoverRingSpaces(query);
  assert.equal(found.spaces.length, 1);
});
