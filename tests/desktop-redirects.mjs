import assert from "node:assert/strict";
import { createServer } from "node:http";

export async function desktopRedirectChecks(frame) {
  const echo = async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ auth: Boolean(request.headers.authorization), bodyPresent: Boolean(body), method: request.method }));
  };
  const target = createServer(echo);
  await new Promise(resolve => target.listen(0, "127.0.0.1", resolve));
  const targetOrigin = "http://127.0.0.1:" + target.address().port;
  const source = createServer((request, response) => {
    const parts = request.url.split("/");
    if (parts[1] === "echo") { void echo(request, response); return; }
    response.writeHead(Number(parts[2]), { Location: parts[1] === "cross" ? targetOrigin + "/echo" : "/echo" }); response.end();
  });
  await new Promise(resolve => source.listen(0, "127.0.0.1", resolve));
  const sourceOrigin = "http://127.0.0.1:" + source.address().port;
  try {
    const results = await frame.evaluate(async sourceOrigin => {
      const results = [];
      for (const status of [301, 302, 303, 307, 308]) for (const method of ["GET", "POST"]) for (const kind of ["same", "cross"]) {
        const response = await window.grove.network.fetch(sourceOrigin + "/" + kind + "/" + status, { method, headers: { Authorization: "Bearer synthetic-redirect-test" }, ...(method === "POST" ? { body: "synthetic-nonsecret-payload" } : {}) });
        results.push({ status, method, kind, finalOrigin: new URL(response.url).origin, redirected: response.redirected, ...await response.json() });
      }
      return results;
    }, sourceOrigin);
    for (const result of results) { assert.equal(result.auth, result.kind === "same"); assert.equal(result.redirected, true); }
    return { mode: "real installed desktop public SDK and IPC, local synthetic HTTP redirects only; no real credential", results };
  } finally {
    await Promise.all([source, target].map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
  }
}
