import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { loadHostRuntime, sdkClient } from './host-network-harness.mjs';
import { loadInstalledHostRuntime } from './installed-host-runtime.mjs';

async function redirectIsolation(runtime, context) {
  const received = [];
  let firstOrigin, secondOrigin;
  const server = createServer((request, response) => {
    const url = new URL(request.url, firstOrigin);
    received.push({ step: url.pathname, authorized: request.headers.authorization === 'Bearer synthetic-redirect-test', method: request.method });
    if (url.pathname.startsWith('/start/')) {
      const status = Number(url.pathname.split('/').at(-1));
      response.writeHead(status, { Location: url.searchParams.get('target') }); response.end();
    } else { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  firstOrigin = 'http://127.0.0.1:' + server.address().port;
  const receiver = createServer((request, response) => {
    received.push({ step: '/other-origin', authorized: Boolean(request.headers.authorization), method: request.method });
    response.writeHead(302, { Location: firstOrigin + '/returned' }); response.end();
  });
  await new Promise(resolve => receiver.listen(0, '127.0.0.1', resolve));
  secondOrigin = 'http://127.0.0.1:' + receiver.address().port;
  const host = sdkClient(runtime);
  try {
    for (const status of [301, 302, 303, 307, 308]) for (const method of ['GET', 'POST']) {
      received.length = 0;
      const init = { method, headers: { Authorization: 'Bearer synthetic-redirect-test' } };
      await host.grove.network.fetch(firstOrigin + '/start/' + status + '?target=' + encodeURIComponent(firstOrigin + '/same-origin'), init);
      assert(received.every(item => item.authorized), 'Same-origin redirect should retain Authorization.');
      received.length = 0;
      await host.grove.network.fetch(firstOrigin + '/start/' + status + '?target=' + encodeURIComponent(secondOrigin + '/target'), init);
      assert.equal(received.length, 3); assert.equal(received[0].authorized, true);
      assert(received.slice(1).every(item => !item.authorized), 'Authorization must not cross origin or reappear on return.');
    }
    assert.equal(host.nativeFetchCalls, 0);
    context.diagnostic('Public SDK/service ' + runtime.sourceVersion + '; 20 local HTTP redirect chains; synthetic credential only, zero production calls. Node ' + process.versions.node + '; not live desktop IPC.');
  } finally { host.close(); await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => receiver.close(resolve))]); }
}

test('宿主源码网络：同 origin 保留鉴权，跨 origin / 返回原点不恢复鉴权', { skip: !process.env.STARMAP_HOST_ROOT }, async context => {
  await redirectIsolation(await loadHostRuntime(process.env.STARMAP_HOST_ROOT), context);
});
test('安装版公开 SDK / 网络服务：HTTP 重定向凭据隔离（非运行中桌面 IPC）', { skip: !process.env.STARMAP_INSTALLED_HOST_ASAR }, async context => {
  await redirectIsolation(await loadInstalledHostRuntime(process.env.STARMAP_INSTALLED_HOST_ASAR), context);
});
