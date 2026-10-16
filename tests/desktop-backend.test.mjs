import assert from "node:assert/strict";
import { test } from "node:test";
import { localBackend } from "./desktop-local-backend.mjs";

const seed = () => ({ demands: [{ id: "isolated", title: "fixture only" }] });
const headers = { Authorization: "Bearer local-test-a", "X-Starmap-Test-Client": "fixture-unit" };

test("桌面测试服务：未知身份不能被模拟为已登录", async () => {
  const backend = await localBackend(seed());
  try {
    assert.equal((await fetch(backend.url + "/api/v4/user")).status, 401);
    assert.equal(backend.fixture.commits, 0);
  } finally { await backend.close(); }
});
test("桌面测试服务：重复服务错误按方法和次数注入", async () => {
  const backend = await localBackend(seed());
  try {
    backend.faults.set("A", { status: 503, remaining: 2, method: "HEAD" });
    const address = backend.url + "/api/v4/projects/9001/repository/files/spaces%2Fisolated-test.json?ref=collaboration";
    assert.equal((await fetch(backend.url + "/api/v4/user", { headers })).status, 200);
    for (const expected of [503, 503, 200]) assert.equal((await fetch(address, { method: "HEAD", headers })).status, expected);
    assert(!backend.faults.has("A"));
  } finally { await backend.close(); }
});
test("桌面测试服务：真实 socket 断开可恢复，计数不含鉴权值", async () => {
  const backend = await localBackend(seed());
  try {
    backend.offline.add("A");
    await assert.rejects(fetch(backend.url + "/api/v4/user", { headers }));
    backend.offline.delete("A");
    assert.equal((await fetch(backend.url + "/api/v4/user", { headers })).status, 200);
    assert(!JSON.stringify(backend.calls).includes(headers.Authorization));
    assert.equal(backend.maximum.get("fixture-unit"), 1);
  } finally { await backend.close(); }
});
test("桌面测试服务：写成功丢回执仍只落一份提交", async () => {
  const backend = await localBackend(seed());
  try {
    backend.dropCommitReply.add("A");
    const changed = { demands: [{ id: "isolated", title: "changed fixture" }] };
    const actions = [
      { action: "update", file_path: "spaces/isolated-test.json", last_commit_id: "commit-0", content: JSON.stringify(changed) },
      { action: "create", file_path: "spaces/isolated-test.meta.json", content: "{}" },
    ];
    await assert.rejects(fetch(backend.url + "/api/v4/projects/9001/repository/commits", { method: "POST", headers, body: JSON.stringify({ branch: "collaboration", actions }) }));
    assert.equal(backend.fixture.commits, 1);
    assert.equal(backend.fixture.state().demands[0].title, "changed fixture");
    assert.equal(backend.calls.filter(call => call.replyDropped).length, 1);
  } finally { await backend.close(); }
});
