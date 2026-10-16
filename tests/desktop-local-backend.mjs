import assert from "node:assert/strict";
import { createServer } from "node:http";
import { gitlabFixture } from "./network-fixture.mjs";

export async function localBackend(state) {
  const fixture = gitlabFixture(state, 'isolated-test', 'collaboration');
  fixture.config.baseUrl = "http://newgit.d5techs.com.cn";
  fixture.config.projectId = 9001;
  const calls = [], offline = new Set(), faults = new Map(), dropCommitReply = new Set();
  const active = new Map(), maximum = new Map();
  const server = createServer(async (request, response) => {
    const authorization = request.headers.authorization || "";
    const account = authorization === "Bearer local-test-a" ? "A" : authorization === "Bearer local-test-b" ? "B" : "none";
    const client = request.headers["x-starmap-test-client"] || account;
    const pathname = new URL(request.url, fixture.config.baseUrl).pathname;
    const observation = { at: Date.now(), method: request.method, pathname, account, client, authPresent: Boolean(authorization) };
    calls.push(observation);
    active.set(client, (active.get(client) || 0) + 1);
    maximum.set(client, Math.max(maximum.get(client) || 0, active.get(client)));
    try {
      if (offline.has(account)) { request.socket.destroy(); return; }
      let body = "";
      for await (const chunk of request) body += chunk;
      await new Promise(resolve => setTimeout(resolve, 40));
      let result;
      const fault = faults.get(account);
      if (account === "none") result = Response.json({}, { status: 401 });
      else if (fault && (!fault.method || fault.method === request.method)) {
        result = Response.json({}, { status: fault.status });
        fault.remaining--;
        if (fault.remaining <= 0) faults.delete(account);
      }
      else if (pathname === "/api/v4/user") result = Response.json({ id: account === "A" ? 501 : 502, username: "local-" + account });
      else result = await fixture.fetch(fixture.config.baseUrl + request.url, { method: request.method, headers: request.headers, ...(body ? { body } : {}) });
      observation.status = result.status;
      if (request.method === "POST" && result.status === 201 && dropCommitReply.delete(account)) { observation.replyDropped = true; request.socket.destroy(); return; }
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
    } catch {
      if (!response.destroyed) response.writeHead(500).end();
    } finally { observation.completedAt = Date.now(); active.set(client, active.get(client) - 1); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { fixture, calls, offline, faults, dropCommitReply, maximum, url: "http://127.0.0.1:" + server.address().port, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

export function isolatedServiceWrapper(serviceName, backend) {
  assert.match(serviceName, /^[A-Za-z_$][\w$]*$/);
  return `
const originalStarmapServices = ${serviceName};
globalThis.starmapTestMetrics = { methods: {}, messages: 0 };
${serviceName} = options => {
  const service = originalStarmapServices({ ...options,
    fetcher: async (address, init) => {
      const url = new URL(address);
      if (url.origin !== "http://newgit.d5techs.com.cn") throw new Error("Local fixture refuses external destination");
      const headers = new Headers(init.headers);
      headers.set("X-Starmap-Test-Client", require("node:path").basename(process.env.PORTAL_DESKTOP_USER_DATA));
      const response = await fetch(${JSON.stringify(backend)} + url.pathname + url.search, { ...init, headers });
      Object.defineProperty(response, "url", { value: url.href });
      return response;
    },
    town: async () => ({ ok: true, data: { entries: [{ town_id: "t_alice", display_name: "Alice" }, { town_id: "t_bob", display_name: "Bob" }], count: 2 } }),
  });
  const call = service.call.bind(service);
  service.call = async (method, value, context) => {
    const metrics = globalThis.starmapTestMetrics;
    metrics.methods[method] = (metrics.methods[method] || 0) + 1;
    if (method === "being.chat" || method === "being.compose") { metrics.messages++; throw new Error("External messaging forbidden in local integration"); }
    return call(method, value, context);
  };
  return service;
};
`;
}
