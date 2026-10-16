import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function nativeRun() {
  const { app, BrowserWindow, dialog, session, shell } = require("electron");
  const fs = require("node:fs/promises"), path = require("node:path");
  const resultPath = process.env.STARMAP_NATIVE_EVIDENCE;
  const signalPath = resultPath + ".restore";
  const evidence = { mode: "native Electron without Playwright or CDP focus emulation" };
  let window, plugin;
  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  async function until(condition, message, timeout = 20000) {
    const end = Date.now() + timeout;
    while (!await condition()) { if (Date.now() > end) throw new Error(message); await sleep(80); }
  }
  const click = (frame, label) => frame.executeJavaScript('(() => { const button = [...document.querySelectorAll("button")].find(element => element.getAttribute("aria-label") === ' + JSON.stringify(label) + ' || element.textContent.trim() === ' + JSON.stringify(label) + '); if (!button) return false; button.click(); return true; })()', true);
  try {
    await app.whenReady();
    session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, callback) => callback({ cancel: true }));
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [process.env.STARMAP_NATIVE_PLUGIN] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    shell.openExternal = async () => { throw new Error("External navigation disabled in native visibility test"); };
    await until(() => { window = BrowserWindow.getAllWindows().find(candidate => !candidate.isDestroyed()); return Boolean(window); }, "Native main window unavailable");
    window.setAlwaysOnTop(true); window.show(); window.focus();
    evidence.testWindowKeptUnoccluded = true;
    const main = window.webContents.mainFrame;
    await until(() => main.executeJavaScript('Boolean(document.querySelector("#client-main"))'), "Native main UI unavailable");
    const toolsPresent = await main.executeJavaScript('[...document.querySelectorAll("button")].some(element => element.textContent.trim() === "工具库")');
    if (!toolsPresent) await click(main, "更多功能");
    await until(() => click(main, "工具库"), "Native tools unavailable");
    await until(() => main.executeJavaScript('(() => { const tab = [...document.querySelectorAll("[role=tab]")].find(element => element.textContent.trim() === "Plugin"); if (!tab) return false; tab.click(); return true; })()', true), "Native plugin tab unavailable");
    await until(() => click(main, "导入插件目录"), "Native plugin import unavailable");
    await until(() => main.executeJavaScript('(() => { const card = [...document.querySelectorAll(".plugin-card")].find(element => element.textContent.includes("星图流程看板")); const button = card && [...card.querySelectorAll("button")].find(element => element.textContent.trim() === "星图"); if (!button) return false; button.click(); return true; })()', true), "Native plugin launcher unavailable");
    await until(async () => { plugin = main.framesInSubtree.find(frame => frame.url.startsWith("beings://plugins/")); return plugin && await plugin.executeJavaScript('Boolean(window.grove && document.querySelector(".pipeline-network-sync"))'); }, "Native plugin unavailable");
    await click(plugin, "登录 / 联网设置");
    window.restore(); window.show(); window.focus();
    await plugin.executeJavaScript('(() => { const fill = (label, value) => { const input = document.querySelector("input[aria-label=" + JSON.stringify(label) + "]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }; fill("联网空间标识", "isolated-test"); fill("GitLab 访问令牌", "local-test-a"); })()', true);
    await click(plugin, "仅本次会话登录");
    await until(() => plugin.executeJavaScript('document.body.textContent.includes("已同步 · isolated-test")'), "Native session did not authenticate with local fixture");
    await plugin.executeJavaScript('(() => { const select = document.querySelector("select[aria-label=自动同步检查间隔]"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "3"); select.dispatchEvent(new Event("change", { bubbles: true })); })()', true);
    await click(plugin, "联网设置");
    await click(plugin, "展开右侧详情栏");
    evidence.visible = await plugin.executeJavaScript('document.visibilityState');
    evidence.backgroundThrottling = window.webContents.getBackgroundThrottling();
    window.minimize();
    await until(() => plugin.executeJavaScript('document.visibilityState === "hidden"'), "Native minimized plugin did not report hidden");
    await sleep(300);
    evidence.hidden = { minimized: window.isMinimized(), visible: window.isVisible(), renderer: await plugin.executeJavaScript('document.visibilityState') };
    await fs.writeFile(resultPath, JSON.stringify({ ...evidence, phase: "hidden" }));
    await until(async () => { try { await fs.access(signalPath); return true; } catch { return false; } }, "Native restore signal unavailable");
    const started = Date.now(); window.restore(); window.show(); window.moveTop(); window.focus();
    await until(() => plugin.executeJavaScript('document.visibilityState === "visible"'), "Native restored window still occluded");
    await until(() => plugin.executeJavaScript('document.querySelector(".pipeline-detail-identity input")?.value === ' + JSON.stringify(process.env.STARMAP_NATIVE_TITLE)), "Native restore did not pull remote change");
    evidence.restored = { visibilityOnRestore: "visible", visibilityAtReceipt: await plugin.executeJavaScript('document.visibilityState'), convergenceMs: Date.now() - started };
    await fs.writeFile(path.join(path.dirname(resultPath), "electron-native-restored.png"), (await window.webContents.capturePage()).toPNG());
    await fs.writeFile(resultPath, JSON.stringify({ ...evidence, phase: "complete", passed: true }));
  } catch (error) {
    if (plugin && !plugin.detached) evidence.failureUI = await plugin.executeJavaScript('({ visibility: document.visibilityState, space: document.querySelector("input[aria-label=联网空间标识]")?.value, alerts: [...document.querySelectorAll("[role=alert]")].map(element => element.textContent), syncText: document.querySelector(".pipeline-network-summary")?.textContent })').catch(() => null);
    if (window && !window.isDestroyed()) evidence.window = { visible: window.isVisible(), minimized: window.isMinimized(), backgroundThrottling: window.webContents.getBackgroundThrottling(), mainVisibility: await window.webContents.executeJavaScript("document.visibilityState") };
    evidence.metrics = globalThis.starmapTestMetrics;
    if (window && !window.isDestroyed()) await fs.writeFile(path.join(path.dirname(resultPath), "electron-native-failure.png"), (await window.webContents.capturePage()).toPNG()).catch(() => {});
    await fs.writeFile(resultPath, JSON.stringify({ ...evidence, phase: "failed", passed: false, error: error.message }));
  } finally { app.exit(); }
}

export function nativeVisibilityBootstrap() {
  return '\n;if (process.env.STARMAP_NATIVE_EVIDENCE) { (' + nativeRun.toString() + ')(); }\n';
}

export async function nativeVisibilityChecks(executable, application, run, plugin, backend) {
  const resultPath = path.join(run, "native-visibility.json");
  const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { PORTAL_DESKTOP_USER_DATA: path.join(run, "native-profile"), STARMAP_NATIVE_EVIDENCE: resultPath, STARMAP_NATIVE_PLUGIN: plugin, STARMAP_NATIVE_TITLE: "原生窗口恢复后的远端变化 " + path.basename(run) });
  const processHandle = spawn(executable, [application], { cwd: application, env, stdio: "ignore", windowsHide: false });
  let launchError;
  processHandle.on("error", error => { launchError = error; });
  async function resultUntil(phase) {
    const end = Date.now() + 60000;
    while (Date.now() < end) {
      if (launchError) throw launchError;
      let value;
      try { value = JSON.parse(await readFile(resultPath, "utf8")); } catch {}
      if (value?.phase === "failed") throw new Error(value.error);
      if (value?.phase === phase) return value;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Native Electron visibility deadline: " + phase);
  }
  try {
    const hidden = await resultUntil("hidden");
    assert.equal(hidden.visible, "visible"); assert.equal(hidden.hidden.renderer, "hidden");
    const callsBefore = backend.calls.length;
    await new Promise(resolve => setTimeout(resolve, 3500));
    assert.equal(backend.calls.length, callsBefore, "Native hidden process still polls");
    const requestsWhileHidden = backend.calls.length - callsBefore;
    const state = backend.fixture.state(); state.demands[0].title = env.STARMAP_NATIVE_TITLE; backend.fixture.put(state);
    await writeFile(resultPath + ".restore", "restore");
    const result = await resultUntil("complete");
    assert.equal(result.passed, true); assert.equal(result.restored.visibilityOnRestore, "visible");
    return { ...result, hiddenObservationMs: 3500, requestsWhileHidden, profile: env.PORTAL_DESKTOP_USER_DATA };
  } finally { if (processHandle.exitCode === null) processHandle.kill(); }
}
