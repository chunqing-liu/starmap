import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { longWorkflowGeometry } from "./desktop-geometry.mjs";

export async function desktopStability({ first, second, backend, run, login, launchAgain, until, progress }) {
  const minimumCycles = Number(process.env.STARMAP_STABILITY_CYCLES || 24);
  const minimumMs = Number(process.env.STARMAP_STABILITY_SECONDS || 600) * 1000;
  assert(Number.isInteger(minimumCycles) && minimumCycles >= 8);
  assert(Number.isFinite(minimumMs) && minimumMs >= 60000);
  const started = Date.now(), rounds = [];
  const result = { mode: "real isolated Electron processes, SDK and IPC; local HTTP GitLab/account/fault simulation only", startedAt: new Date(started).toISOString(), requestedCycles: minimumCycles, minimumDurationMs: minimumMs, rounds, passed: false };
  const save = () => writeFile(path.join(run, "stability.json"), JSON.stringify({ ...result, elapsedMs: Date.now() - started }, null, 2));
  await save();
  const task = client => client.frame.getByRole("textbox", { name: "任务名称", exact: true });
  const effectiveNodes = () => { const demand = backend.fixture.state().demands[0]; return demand.customNodes.map(node => ({ ...node, ...demand.nodeOverrides[node.id], status: demand.nodeStates[node.id] || node.status })); };
  const settle = client => client.bar.getByText(/^已同步 · isolated-test$/).waitFor({ timeout: 30000 });
  const clearSelection = async client => {
    const expand = client.frame.getByRole("button", { name: "展开右侧详情栏", exact: true });
    if (await expand.isVisible()) await expand.click();
    await client.frame.locator(".react-flow__pane").click({ position: { x: 10, y: 10 } });
  };
  const logout = async client => {
    const settings = client.bar.getByRole("region", { name: "登录与自动同步设置", exact: true });
    if (!await settings.isVisible()) await client.bar.getByRole("button", { name: "联网设置", exact: true }).click();
    await client.bar.getByRole("button", { name: "退出账号", exact: true }).click();
    await client.bar.getByLabel("GitLab 访问令牌", { exact: true }).waitFor();
    await client.bar.locator(".pipeline-network-summary [role=status]").filter({ hasText: "未登录" }).waitFor();
  };
  await first.window.evaluate(window => window.setContentSize(1440, 960));
  await clearSelection(first); await clearSelection(second);
  progress("stability: build and edit a longer workflow through real UI");
  const longTitles = [];
  for (let index = 0; index < 16; index++) {
    const name = "夜间长流程节点 " + String(index + 1).padStart(2, "0");
    longTitles.push(name);
    await first.frame.getByRole("button", { name: "+ 节点", exact: true }).click();
    await first.frame.getByLabel("名称", { exact: true }).fill(name);
    await first.frame.getByLabel("负责 Being 地址", { exact: true }).fill("t_alice, t_bob");
  }
  await clearSelection(first);
  await until(() => longTitles.every(name => effectiveNodes().some(node => node.title === name)), "Long workflow edits were not all uploaded", 30000);
  for (const name of longTitles) await until(async () => (await second.frame.locator(".react-flow__node").allTextContents()).some(text => text.includes(name)), "Second client lost long workflow node: " + name);
  result.longWorkflow = { addedNodes: longTitles.length, totalNodes: effectiveNodes().length, parallelOwnersPreserved: effectiveNodes().filter(node => longTitles.includes(node.title)).every(node => node.responsibleBeingIds.join(",") === "t_alice,t_bob") };
  assert(result.longWorkflow.parallelOwnersPreserved);
  await first.frame.getByRole("button", { name: "适配", exact: true }).click();
  result.longWorkflow.geometry = await longWorkflowGeometry(first, longTitles, until);
  await first.page.screenshot({ path: path.join(run, "electron-long-workflow.png") });
  let nodeTitle = "新节点";
  for (let cycle = 1; cycle <= minimumCycles; cycle++) {
    const roundStart = Date.now(), round = { cycle, startedAt: new Date().toISOString(), scenarios: [], passed: false };
    rounds.push(round);
    progress("stability cycle " + cycle + "/" + minimumCycles);
    try {
      await clearSelection(first); await clearSelection(second);
      const forward = "夜间 A 自动上传 " + cycle;
      await task(first).fill(forward);
      await until(async () => await task(second).inputValue() === forward, "A to B automatic convergence failed in cycle " + cycle, 22000);
      const reverse = "夜间 B 自动上传 " + cycle;
      await task(second).fill(reverse);
      await until(async () => await task(first).inputValue() === reverse, "B to A automatic convergence failed in cycle " + cycle, 22000);
      round.scenarios.push("bidirectional automatic upload and polling pull");
      await first.frame.getByRole("region", { name: "当前节点与阶段耗时", exact: true }).getByRole("button", { name: nodeTitle + " · 流程角色", exact: true }).click();
      nodeTitle = "真实节点编辑 " + cycle;
      await first.frame.getByLabel("名称", { exact: true }).fill(nodeTitle);
      const status = first.frame.locator(".pipeline-detail-meta label").filter({ hasText: "状态" }).locator("select");
      await status.selectOption("done");
      await status.selectOption("running");
      await clearSelection(first);
      await until(() => effectiveNodes().find(node => node.id === "first").title === nodeTitle, "Node edit did not upload");
      await until(async () => (await second.frame.locator('.react-flow__node[data-id="first"]').textContent()).includes(nodeTitle), "Second client did not render node edit");
      const facts = backend.fixture.state().demands[0].activityEvents.filter(event => event.nodeId === "first");
      assert(facts.length >= cycle * 2 + 3 && facts.every(event => Date.parse(event.at) <= Date.now()));
      round.scenarios.push("node edits and genuine new transition timestamps");
      if (cycle % 3 === 0) {
        backend.offline.add("A");
        const offlineValue = "反复断网草稿 " + cycle;
        await task(first).fill(offlineValue); await first.bar.getByText(/^离线待传/).waitFor();
        const count = backend.calls.filter(call => call.account === "A").length;
        await new Promise(resolve => setTimeout(resolve, 1200));
        assert.equal(backend.calls.filter(call => call.account === "A").length, count, "Socket failure caused request storm");
        backend.offline.delete("A");
        if (cycle % 2 === 0) await first.frame.evaluate(() => window.dispatchEvent(new Event("online")));
        await until(async () => await task(second).inputValue() === offlineValue, "Repeated outage failed to recover", 30000);
        round.scenarios.push(cycle % 2 === 0 ? "real socket loss and simulated online-event recovery" : "real socket loss and automatic backoff recovery without wake event");
      }
      if (cycle % 4 === 0) {
        const statusCode = cycle % 8 === 0 ? 429 : 503;
        backend.faults.set("A", { status: statusCode, remaining: 2, method: "HEAD" });
        await first.bar.getByText(/HTTP /).waitFor({ timeout: 18000 });
        const failuresStart = backend.calls.length;
        const value = "服务错误恢复 " + cycle;
        await task(first).fill(value);
        await until(async () => await task(second).inputValue() === value, "Service error retry did not recover", 40000);
        const retries = backend.calls.slice(failuresStart).filter(call => call.account === "A" && call.method === "HEAD");
        assert(retries.length >= 2);
        assert(retries[1].at - retries[0].at >= 5000, "Service retries skipped exponential backoff");
        round.scenarios.push("HTTP " + statusCode + " repeated errors and non-overlapping backoff recovery");
      }
      if (cycle % 6 === 0) {
        await settle(first); await settle(second);
        let release, reached;
        const arrival = new Promise(resolve => { reached = resolve; }), hold = new Promise(resolve => { release = resolve; });
        backend.fixture.beforeCommit = async () => { reached(); await hold; };
        const local = "夜间显式保留 A " + cycle, remote = "夜间先提交 B " + cycle;
        try {
          await task(first).fill(local);
          await Promise.race([arrival, new Promise((_, reject) => setTimeout(() => reject(new Error("Conflict commit never reached backend")), 15000))]);
          await task(second).fill(remote);
          await until(() => backend.fixture.state().demands[0].title === remote, "Concurrent B write did not commit");
        } finally { release(); }
        const conflict = first.frame.getByRole("region", { name: "联网字段冲突", exact: true });
        await conflict.waitFor();
        assert.equal(backend.fixture.state().demands[0].title, remote, "Conflict silently overwrote B");
        for (const choice of await conflict.getByRole("combobox").all()) await choice.selectOption("local");
        await conflict.getByRole("button", { name: "应用冲突选择", exact: true }).click();
        await until(async () => await task(second).inputValue() === local, "Explicit conflict resolution did not converge");
        round.scenarios.push("concurrent CAS conflict, no silent overwrite, explicit resolution");
      }
      if (cycle % 8 === 0) {
        backend.faults.set("A", { status: 401, remaining: 100, method: "HEAD" });
        await first.bar.getByText(/凭据无效或过期/).waitFor({ timeout: 16000 });
        const calls = backend.calls.filter(call => call.account === "A").length;
        const pending = "凭据失效保留草稿 " + cycle;
        await task(first).fill(pending);
        await new Promise(resolve => setTimeout(resolve, 3500));
        assert.equal(backend.calls.filter(call => call.account === "A").length, calls, "Expired session kept polling");
        backend.faults.delete("A"); await logout(first); await login(first, "A");
        await until(async () => await task(second).inputValue() === pending, "Fresh login lost pending draft");
        round.scenarios.push("401 expiry pauses requests and fresh memory login restores draft");
      }
      if (cycle === 5) {
        backend.faults.set("A", { status: 403, remaining: 100, method: "HEAD" });
        await first.bar.getByText(/拒绝访问或写入/).waitFor({ timeout: 16000 });
        const count = backend.calls.filter(call => call.account === "A").length;
        await new Promise(resolve => setTimeout(resolve, 3500));
        assert.equal(backend.calls.filter(call => call.account === "A").length, count);
        backend.faults.delete("A"); await logout(first); await login(first, "A");
        round.scenarios.push("403 permission refusal stops retries; no bypass");
      }
      if (cycle % 6 === 2) {
        await settle(first);
        const commits = backend.fixture.commits, value = "写成功丢回执 " + cycle;
        backend.dropCommitReply.add("A");
        await task(first).fill(value);
        await until(() => backend.calls.some(call => call.replyDropped && call.at >= roundStart), "Successful write receipt was not dropped");
        await settle(first);
        await until(async () => await task(second).inputValue() === value, "Lost reply was not reconciled", 30000);
        assert.equal(backend.fixture.commits, commits + 1, "Unknown receipt replayed write");
        round.scenarios.push("committed write with socket-lost receipt, readback without duplicate commit");
      }
      if (cycle % 8 === 7) {
        const pending = "退出重启的账号 A 草稿 " + cycle;
        backend.offline.add("A"); await task(first).fill(pending); await first.bar.getByText(/^离线待传/).waitFor();
        await first.frame.locator("#plugin-status").filter({ hasText: "已保存到本机" }).waitFor();
        const profile = first.runtime.userData;
        await first.application.close();
        Object.assign(first, await launchAgain(profile));
        await clearSelection(first);
        assert(await first.bar.locator(".pipeline-network-summary [role=status]").textContent().then(text => text.includes("未登录")));
        const count = backend.calls.filter(call => call.account === "A").length;
        await new Promise(resolve => setTimeout(resolve, 3500));
        assert.equal(backend.calls.filter(call => call.account === "A").length, count, "Restart reused a supposedly memory-only credential");
        await login(first, "B"); assert.notEqual(await task(first).inputValue(), pending);
        await logout(first); backend.offline.delete("A"); await login(first, "A");
        await until(async () => await task(second).inputValue() === pending, "Restarted A lost durable account-scoped draft");
        round.scenarios.push("real process exit/restart; memory credential cleared; account B isolated; A draft recovered");
      }
      await settle(first); await settle(second);
      for (const client of [first, second]) assert(!(await client.frame.locator("#plugin-status").textContent()).includes("保存失败"), "Host local persistence failed during stability loop");
      assert([...backend.maximum.values()].every(count => count <= 1), "Overlapping sync requests detected");
      round.passed = true; round.elapsedMs = Date.now() - roundStart;
      await save();
      const remaining = started + minimumMs * cycle / minimumCycles - Date.now();
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    } catch (error) { round.error = error.message; await save(); throw error; }
  }
  result.completedAt = new Date().toISOString(); result.elapsedMs = Date.now() - started; result.passed = true;
  assert(result.elapsedMs >= minimumMs - 20);
  result.commits = backend.fixture.commits; result.requests = backend.calls.length;
  await save();
  return result;
}
