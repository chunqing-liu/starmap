import { build } from 'esbuild';
import { createContext, runInContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function loadHostRuntime(root) {
  if (!root) throw new Error('Set STARMAP_HOST_ROOT to a local desktop source checkout.');
  const compiled = await build({ bundle: true, write: false, platform: 'node', format: 'esm', stdin: {
    contents: 'export { PLUGIN_SDK } from "./desktop/shared/plugin-sdk"; export { createPluginServices, capabilityFor } from "./desktop/main/plugins/services";', resolveDir: root,
  } });
  const runtime = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  return { ...runtime, sourceVersion: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version };
}

export function sdkClient(runtime, allowed = ['network'], fetcher = globalThis.fetch) {
  const events = new Map(), requests = [];
  const controller = new AbortController();
  const unavailable = () => { throw new Error('Non-network service is not part of this isolated harness.'); };
  const services = runtime.createPluginServices({ contextKey: () => 'isolated-network-test', being: unavailable,
    endpoint: unavailable, town: unavailable, proxy: { handle: unavailable }, confirmChat: unavailable, fetcher });
  const parent = { postMessage(message) {
    if (message.type !== 'grove:request') return;
    requests.push(message.method);
    void (async () => {
      let reply;
      try {
        if (!allowed.includes(runtime.capabilityFor(message.method, message.value))) throw new Error('Capability not granted.');
        const value = await services.call(message.method, message.value, { manifest: { capabilities: allowed }, signal: controller.signal,
          emit: unavailable, check: () => controller.signal.throwIfAborted() });
        reply = { value };
      } catch { reply = { error: 'Host request failed or capability denied.' }; }
      for (const callback of events.get('message') || []) callback({ source: parent, data: { type: 'grove:response', channel: 'isolated', id: message.id, ...reply } });
    })();
  } };
  let nativeFetchCalls = 0;
  const context = createContext({ parent, document: { currentScript: { dataset: { channel: 'isolated', view: 'board' } }, documentElement: { dataset: {} } },
    Headers, Response, URL, setTimeout, clearTimeout,
    fetch: () => { nativeFetchCalls++; throw new Error('Native iframe fetch is deliberately unavailable.'); },
    addEventListener: (type, callback) => events.set(type, [...(events.get(type) || []), callback]) });
  context.window = context;
  runInContext(runtime.PLUGIN_SDK, context, { timeout: 2000 });
  return { grove: context.grove, requests, get nativeFetchCalls() { return nativeFetchCalls; }, close() {
    controller.abort(); for (const callback of events.get('pagehide') || []) callback();
  } };
}
