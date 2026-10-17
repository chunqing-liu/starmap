import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ bundle: true, write: false, platform: 'node', format: 'esm', stdin: { contents: 'export * from "./src/shared-connection";', resolveDir: fileURLToPath(new URL('../', import.meta.url)) } });
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const config = { baseUrl: 'https://gitlab.example.invalid', projectId: 724, branch: 'starmap-test-20261016' };

test('分享信息只包含可公开给获授权成员的连接目标，不包含凭据或账号', () => {
  const value = api.createSharedConnection(config, 'connection-20261016-1034');
  assert.deepEqual(Object.keys(value).sort(), ['baseUrl', 'branch', 'kind', 'projectId', 'space', 'version']);
  assert.equal(api.serializeSharedConnection(config, value.space).includes('token'), false);
  assert.equal(api.serializeSharedConnection(config, value.space).includes('username'), false);
});

test('接收端可校验、预览并往返解析连接信息', () => {
  const text = api.serializeSharedConnection(config, 'team-alpha');
  assert.deepEqual(api.parseSharedConnection(text), { kind: 'starmap-connection', version: 1, ...config, space: 'team-alpha' });
});

test('含令牌字段、未知字段、非法 origin 或目标时拒绝且不产生替代目标', () => {
  const valid = JSON.parse(api.serializeSharedConnection(config, 'team-alpha'));
  assert.throws(() => api.parseSharedConnection(JSON.stringify({ ...valid, token: 'secret' })), error => error.code === 'format');
  assert.throws(() => api.parseSharedConnection(JSON.stringify({ ...valid, extra: 'value' })), error => error.code === 'format');
  assert.throws(() => api.parseSharedConnection(JSON.stringify({ ...valid, baseUrl: 'https://gitlab.example.invalid/group' })), error => error.code === 'format');
  assert.throws(() => api.parseSharedConnection(JSON.stringify({ ...valid, branch: 'master..other' })), error => error.code === 'format');
  assert.throws(() => api.parseSharedConnection(JSON.stringify({ ...valid, space: '../other' })), error => error.code === 'format');
});

test('精确授权 HTTP origin 可沿用现有登录边界，其它 HTTP origin 仍拒绝', () => {
  assert.doesNotThrow(() => api.createSharedConnection({ baseUrl: 'http://newgit.d5techs.com.cn', projectId: 724, branch: 'collaboration' }, 'team-alpha'));
  assert.throws(() => api.createSharedConnection({ baseUrl: 'http://gitlab.example.invalid', projectId: 724, branch: 'collaboration' }, 'team-alpha'), error => error.code === 'insecure');
});
