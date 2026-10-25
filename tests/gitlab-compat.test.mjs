import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ bundle: true, write: false, platform: 'node', format: 'esm', stdin: { contents: 'export * from "./src/gitlab-client"; export * from "./src/models/templates";', resolveDir: fileURLToPath(new URL('../', import.meta.url)) } });
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const space = 'compatibility-space';
const branch = 'collaboration';
const config = { baseUrl: 'https://gitlab.fixture.invalid', projectId: 9001, branch };
const snapshot = 'a'.repeat(40), fileRevision = 'b'.repeat(40), metadataRevision = 'c'.repeat(40);
const dataBlob = 'd'.repeat(40), metadataBlob = 'e'.repeat(40);
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });

function compatibilityServer(options = {}) {
  const calls = [], state = structuredClone(api.createInitialPipelineState());
  state.demands = [structuredClone(api.defaultDemand), structuredClone(api.defaultBugDemand)];
  state.selectedDemandId = state.demands[0].id;
  let committed = false;
  const fetch = async (address, init = {}) => {
    const url = new URL(address), endpoint = url.pathname.split('/projects/9001')[1];
    const method = init.method || 'GET';
    calls.push({ endpoint, method, query: Object.fromEntries(url.searchParams), body: init.body ? JSON.parse(init.body) : null });
    if (endpoint.startsWith('/repository/files/')) return json({}, 404);
    if (endpoint.startsWith('/repository/branches/')) {
      assert.equal(decodeURIComponent(endpoint.split('/branches/')[1]), branch);
      if (options.missingBranch) return json({}, 404);
      return json({ name: branch, commit: { id: snapshot } });
    }
    if (endpoint === '/repository/tree') {
      if (options.denied) return json({}, 403);
      assert([branch, snapshot].includes(url.searchParams.get('ref')));
      assert.equal(url.searchParams.get('path'), 'spaces');
      if (options.missingFile) return json([]);
      if (options.paginated && url.searchParams.get('page') === '1') return json([], 200, { 'x-next-page': '2' });
      return json([
        { name: space + '.json', path: options.badPath ? 'other/' + space + '.json' : 'spaces/' + space + '.json', type: 'blob', id: dataBlob },
        { name: space + '.meta.json', path: 'spaces/' + space + '.meta.json', type: 'blob', id: metadataBlob },
      ]);
    }
    if (endpoint === '/repository/commits' && method === 'GET') {
      assert.equal(url.searchParams.get('ref_name'), snapshot);
      return json(options.emptyHistory ? [] : [{ id: committed ? snapshot : url.searchParams.get('path').endsWith('.meta.json') ? metadataRevision : fileRevision }]);
    }
    if (endpoint.startsWith('/repository/blobs/')) {
      const metadata = endpoint.endsWith(metadataBlob);
      return json({ encoding: 'base64', content: Buffer.from(JSON.stringify(metadata ? { previous_rev: null } : state)).toString('base64') });
    }
    if (endpoint === '/repository/commits' && method === 'POST') {
      const body = JSON.parse(init.body);
      assert.equal(body.branch, branch);
      assert.deepEqual(body.actions.map(action => [action.file_path, action.last_commit_id]), [['spaces/' + space + '.json', fileRevision], ['spaces/' + space + '.meta.json', metadataRevision]]);
      if (options.writeRace) return json({ message: 'file changed' }, 400);
      committed = true;
      return json({ id: snapshot }, 201);
    }
    if (!endpoint) return json({ id: 9001, path_with_namespace: 'fixture/starmap' });
    throw new Error('Unexpected public API route: ' + endpoint);
  };
  return { calls, state, client: new api.GitLabClient(fetch, async () => 'synthetic-compatibility-test-only', config) };
}

test('模拟：文件API404时通过官方目录和blob读取，正文与元信息固定同一提交', async () => {
  const server = compatibilityServer({ paginated: true });
  const result = await server.client.load(space);
  assert.deepEqual(result.state, api.validateState(server.state));
  assert.equal(result.rev, fileRevision); assert.equal(result.metaRev, metadataRevision);
  const trees = server.calls.filter(call => call.endpoint === '/repository/tree');
  assert(trees.some(call => call.query.ref === branch));
  assert(trees.filter(call => call.query.ref === snapshot).length >= 4);
  assert.equal(server.calls.filter(call => call.endpoint.includes('/branches/')).length, 1);
  assert(server.calls.every(call => call.method === 'GET' && !JSON.stringify(call.query).includes('master')));
});

test('模拟：兼容轮询只读文件版本不下载blob，不把分支上其它文件提交当文件版本', async () => {
  const server = compatibilityServer();
  assert.equal(await server.client.revision(space), fileRevision);
  assert.equal(await server.client.revision(space), fileRevision);
  assert.equal(server.calls.filter(call => call.endpoint.includes('/blobs/')).length, 0);
  assert.equal(server.calls.filter(call => call.endpoint.includes('/files/')).length, 1);
});

test('模拟：兼容写入仍使用每个文件的last_commit_id，服务端竞争不覆盖', async () => {
  for (const writeRace of [false, true]) {
    const server = compatibilityServer({ writeRace });
    const next = structuredClone(server.state); next.demands[0].title = 'compatibility update';
    if (writeRace) await assert.rejects(server.client.save(space, next, fileRevision, 'fixture'), error => error.code === 'conflict');
    else assert.equal((await server.client.save(space, next, fileRevision, 'fixture')).rev, snapshot);
    assert.equal(server.calls.filter(call => call.method === 'POST').length, 1);
  }
});

test('模拟：目录拒绝、缺分支、错路径或无文件版本均阻断，不回退master', async () => {
  for (const [options, code] of [[{ denied: true }, 'forbidden'], [{ missingBranch: true }, 'missing-branch'], [{ badPath: true }, 'format'], [{ emptyHistory: true }, 'format']]) {
    const server = compatibilityServer(options);
    await assert.rejects(server.client.load(space), error => error.code === code);
    assert(server.calls.every(call => call.method === 'GET' && !JSON.stringify(call).includes('master')));
  }
});

test('模拟：真正缺文件需要再次核验精确项目与分支，不能凭文件404创建', async () => {
  const server = compatibilityServer({ missingFile: true, missingBranch: true });
  await assert.rejects(server.client.load(space), error => error.code === 'missing-branch');
  assert.equal(server.calls.filter(call => call.method === 'POST').length, 0);
});
