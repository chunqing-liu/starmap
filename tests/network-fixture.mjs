import assert from 'node:assert/strict';

export function memoryCache(seed = {}) {
  const values = { ...seed };
  return { values, fail: false, getItem: key => values[key] ?? null,
    async setItems(patch) { if (this.fail) throw new Error('isolated quota failure'); Object.assign(values, patch); } };
}
export function gitlabFixture(initial, space = 'isolated-test', branch = 'master') {
  let head = 'commit-0', sequence = 0;
  const files = new Map(), history = new Map();
  if (initial) files.set('spaces/' + space + '.json', { content: JSON.stringify(initial), rev: head });
  history.set(head, structuredClone(files));
  const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const fixture = {
    config: { baseUrl: 'https://gitlab.fixture.invalid', projectId: 9001, branch },
    offline: false, deny: 0, hidden: false, missingBranch: false, loseReply: false, beforeCommit: null, beforeRead: null, commits: 0, calls: [],
    state: () => JSON.parse(files.get('spaces/' + space + '.json').content),
    put(state) { head = 'commit-' + ++sequence; files.set('spaces/' + space + '.json', { content: JSON.stringify(state), rev: head }); history.set(head, structuredClone(files)); return head; },
    async fetch(address, init = {}) {
      const url = new URL(address), method = init.method || 'GET';
      assert.equal(url.origin, fixture.config.baseUrl, 'Fixture may not contact a real repository');
      fixture.calls.push({ method, pathname: url.pathname, ref: url.searchParams.get('ref') });
      if (fixture.offline) throw new Error('fixture-only transport failure');
      if (fixture.deny) return response({}, fixture.deny);
      if (fixture.hidden) return response({}, 404);
      if (!new Headers(init.headers).get('Authorization')) return response({}, 401);
      if (url.pathname === '/api/v4/user') return response({ id: 101, username: 'isolated-user' });
      const endpoint = url.pathname.replace('/api/v4/projects/' + fixture.config.projectId, '');
      if (endpoint === '') return response({ id: fixture.config.projectId, path_with_namespace: 'fixture/starmap' });
      if (endpoint === '/repository/branches/' + encodeURIComponent(branch)) return response({ name: branch }, fixture.missingBranch ? 404 : 200);
      if (fixture.missingBranch) return response({}, 404);
      if (endpoint === '/repository/tree') { assert.equal(url.searchParams.get('ref'), branch); return response([...files.keys()].map(file => ({ type: 'blob', name: file.split('/').at(-1) }))); }
      if (endpoint.startsWith('/repository/files/')) {
        if (fixture.beforeRead) { const hook = fixture.beforeRead; fixture.beforeRead = null; await hook(); }
        const ref = url.searchParams.get('ref'), snapshot = ref === branch ? files : history.get(ref);
        assert(ref === branch || history.has(ref), 'Only selected branch or its pinned snapshot may be read');
        const file = snapshot?.get(decodeURIComponent(endpoint.slice('/repository/files/'.length)));
        if (method === 'HEAD') return new Response(null, { status: file ? 200 : 404, headers: file ? { 'x-gitlab-last-commit-id': file.rev } : {} });
        return file ? response({ encoding: 'base64', content: Buffer.from(file.content).toString('base64'), last_commit_id: file.rev, commit_id: ref === branch ? head : ref }) : response({}, 404);
      }
      if (endpoint === '/repository/commits' && method === 'POST') {
        if (fixture.beforeCommit) { const hook = fixture.beforeCommit; fixture.beforeCommit = null; await hook(); }
        const body = JSON.parse(init.body);
        assert.equal(body.branch, branch); assert.equal(body.actions.length, 2);
        for (const action of body.actions) {
          assert.match(action.file_path, /^spaces\/[a-zA-Z0-9_-]+(?:\.meta)?\.json$/);
          const existing = files.get(action.file_path);
          if (action.action === 'create' ? Boolean(existing) : !existing || existing.rev !== action.last_commit_id) return response({ message: 'fixture CAS conflict' }, 400);
        }
        head = 'commit-' + ++sequence;
        for (const action of body.actions) files.set(action.file_path, { content: action.content, rev: head });
        history.set(head, structuredClone(files)); fixture.commits++;
        if (fixture.loseReply) { fixture.loseReply = false; throw new Error('fixture lost successful response'); }
        return response({ id: head }, 201);
      }
      return response({}, 404);
    },
  };
  return fixture;
}
