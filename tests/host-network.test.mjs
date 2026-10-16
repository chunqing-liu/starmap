import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { gitlabFixture, memoryCache } from './network-fixture.mjs';
import { loadHostRuntime, sdkClient } from './host-network-harness.mjs';

test('宿主源码集成：真实 SDK + network.fetch 服务 + 模拟 HTTPS 双客户端（非桌面 / TLS 实机）', { skip: !process.env.STARMAP_HOST_ROOT }, async context => {
  const runtime = await loadHostRuntime(process.env.STARMAP_HOST_ROOT);
  const compiled = await build({ bundle: true, write: false, platform: 'node', format: 'esm', stdin: {
    contents: 'export * from "./src/storage"; export * from "./src/sync"; export * from "./src/gitlab-client"; export * from "./src/models/templates";', resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  } });
  const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  const fixture = gitlabFixture(api.createInitialPipelineState());
  const firstHost = sdkClient(runtime, ['network'], fixture.fetch), secondHost = sdkClient(runtime, ['network'], fixture.fetch), deniedHost = sdkClient(runtime, [], fixture.fetch);
  context.after(() => { firstHost.close(); secondHost.close(); deniedHost.close(); });
  const create = host => new api.TeamSync(api.createTeamStorage(host.grove.network.fetch, async () => 'isolated-fixture-credential', fixture.config), memoryCache(), 'isolated-test', api.createInitialPipelineState());
  const first = create(firstHost), second = create(secondHost);
  await first.pull(); await second.pull(); assert.equal(first.snapshot().status, 'synced'); assert.equal(second.snapshot().status, 'synced');
  const firstDraft = structuredClone(first.snapshot().draft), secondDraft = structuredClone(second.snapshot().draft);
  firstDraft.demands[0].title = '模拟 HTTPS 客户端 A'; secondDraft.demands[0].summary = '模拟 HTTPS 客户端 B';
  await first.stage(firstDraft); await second.stage(secondDraft); await first.push('isolated A'); await second.push('isolated B');
  assert.equal(second.snapshot().status, 'dirty'); assert.equal(fixture.commits, 1);
  await second.push('isolated B'); await first.pull(); assert.equal(fixture.commits, 2); assert(api.sameState(first.snapshot().draft, second.snapshot().draft));
  assert.equal(firstHost.nativeFetchCalls + secondHost.nativeFetchCalls, 0);
  assert(firstHost.requests.every(method => method === 'network.fetch')); assert(secondHost.requests.every(method => method === 'network.fetch'));
  const calls = fixture.calls.length; await assert.rejects(deniedHost.grove.network.fetch(fixture.config.baseUrl), /denied/); assert.equal(fixture.calls.length, calls);
  await assert.rejects(firstHost.grove.network.fetch('file:///isolated'), /failed/);
  context.diagnostic('Local desktop source ' + runtime.sourceVersion + ', injected SDK ' + firstHost.grove.sdkVersion + '; independent VM contexts and simulated HTTPS transport, no real TLS or team writes.');
});
