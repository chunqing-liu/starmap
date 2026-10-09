import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const endpoint = process.env.OFFICE_CDP_URL || 'http://127.0.0.1:9224';
assert(!endpoint.includes(':9223'));
const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('http://localhost:') || candidate.url().startsWith('http://127.0.0.1:'));
assert(page, 'P6R3 uses an owned development fixture, never the human instance');
const directory = 'desktop/renderer/pipeline/office/p6r3-screenshots';
const originalState = await page.evaluate(() => localStorage.getItem('beings:star-map:v4'));
const originalRoster = (await page.evaluate(() => window.beings.officeSnapshot())).entries;
const errors = [], evidence = [], results = [], runOrder = Date.now();
let eventOrder = 0, heartbeat, session;
page.on('pageerror', error => errors.push(error.message));
const diagnostic = () => page.locator('.office-scene').evaluate(element => JSON.parse(element.dataset.officeDiagnostics));
const report = async (beingId, fields) => {
  const input = { beingId, runId: 'p6r3-' + runOrder, runOrder, eventId: 'p6r3-' + runOrder + '-' + ++eventOrder, eventOrder, ...fields };
  const receipt = await page.evaluate(input => { if (input.type === 'presence') input.lastSeen = Date.now(); return window.beings.officeTestInject(input); }, input);
  assert(receipt.accepted, JSON.stringify(receipt)); return input;
};
const pass = name => { results.push(name); console.log('PASS ' + name); };
const identities = Array.from({ length: 100 }, (_, index) => ({ id: 'r3-person-' + index, name: '伙伴 ' + (index + 1), role: ['产品', '后端开发', '引擎开发', '测试', '前端开发'][index % 5], owners: [], assignedUsers: [], color: [0xd9ae7c, 0x8cafaa, 0x759cc4, 0xa7b98b, 0xa899c6][index % 5], demo: false }));
const open = async () => {
  await page.locator('#options-home button').filter({ hasText: '小镇' }).evaluate(button => button.click());
  await page.locator('.place-switcher button').filter({ hasText: '星图' }).click();
  const close = page.getByRole('button', { name: '关闭独立协作舱', exact: true });
  if (await close.isVisible()) await close.click();
  await page.getByRole('button', { name: '办公室 · 实验', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.office-scene')?.dataset.officeDiagnostics);
};
const roster = async entries => {
  await page.getByLabel('减少动态效果').check();
  const snapshot = await page.evaluate(() => window.beings.officeSnapshot());
  for (const entry of snapshot.entries) await report(entry.identity.id, { type: 'unregister' });
  for (const identity of entries) {
    await report(identity.id, { type: 'register', identity });
    await report(identity.id, { type: 'presence', status: 'idle', lastSeen: Date.now(), summary: '' });
  }
  await page.reload(); await open();
  await page.waitForFunction(count => JSON.parse(document.querySelector('.office-scene').dataset.officeDiagnostics).actors === count, entries.length);
  const value = await diagnostic(); assert.equal(value.desks, entries.length); assert.equal(value.sceneObjects.length, 5); assert.equal(value.positionMismatches, 0);
  await page.getByLabel('减少动态效果').uncheck();
};
const sceneFrame = async () => {
  const bounds = await page.locator('.office-scene').boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const image = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { x: bounds.x, y: bounds.y, width: Math.min(bounds.width, viewport.width - bounds.x), height: Math.min(bounds.height, viewport.height - bounds.y), scale: 1 } });
  return Buffer.from(image.data, 'base64');
};
const capture = async (file, description) => {
  await page.mouse.move(10, 10); await page.waitForTimeout(200);
  await writeFile(directory + '/' + file, await sceneFrame());
  const item = { file, description, capturedAt: new Date().toISOString(), diagnostics: await diagnostic() };
  const existing = evidence.findIndex(item => item.file === file);
  if (existing < 0) evidence.push(item); else evidence[existing] = item;
  console.log('CAPTURE ' + file);
};
try {
  await mkdir(directory, { recursive: true });
  session = await page.context().newCDPSession(page);
  await session.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
  await page.evaluate(() => { localStorage.removeItem('beings:star-map:v4'); localStorage.setItem('starmap-office-open', 'true'); localStorage.setItem('starmap-office-reduced', 'true'); });
  await page.reload(); await open();
  heartbeat = setInterval(async () => {
    try { for (const entry of (await page.evaluate(() => window.beings.officeSnapshot())).entries) await report(entry.identity.id, { type: 'presence', status: entry.status, lastSeen: Date.now(), summary: entry.summary }); } catch {}
  }, 15000);
  if (process.env.OFFICE_EVIDENCE_RESUME === '1') {
    const previous = JSON.parse(await readFile(directory + '/verification.json', 'utf8'));
    assert(previous.results.length >= 8 && previous.evidence.length >= 6, 'resume requires completed first-half evidence');
    results.push(...previous.results.slice(0, 8)); evidence.push(...previous.evidence);
    console.log('REUSE ' + previous.evidence.length + ' completed screenshots and ' + results.length + ' checks');
  } else {
  for (const count of [0, 1, 2, 3, 6]) { await roster(identities.slice(0, count)); pass(count + ' people, matching workplaces and five real scene objects'); }
  await page.waitForFunction(() => { const actors = JSON.parse(document.querySelector('.office-scene').dataset.officeDiagnostics).visualActors; return actors.length === 6 && actors.every(actor => actor.stage === 'interacting') && actors.some(actor => actor.activity === 'brew'); }, undefined, { timeout: 30000 });
  const idle = await diagnostic(); assert(idle.visualActors.every(actor => actor.screen === 'off'));
  assert(idle.visualActors.filter(actor => ['phone', 'read'].includes(actor.activity)).every(actor => actor.seated));
  assert.equal(await page.locator('.office-actor-label:visible').count(), 0);
  await capture('01-coffee-interaction.png', '咖啡机前接咖啡；出杯口、流液、指示灯和抬手相对位');
  await capture('04-fitness-corner.png', '哑铃架和瑜伽垫前弯举；人物站在健身点');
  await capture('05-reading-corner.png', '书架和落地灯旁坐单人沙发翻书；手机伙伴坐长沙发');
  pass('idle partners reach the actual objects, with seated reading/phone and no permanent labels');
  const first = idle.visualActors.find(actor => actor.activity === 'brew');
  await page.waitForFunction(id => JSON.parse(document.querySelector('.office-scene').dataset.officeDiagnostics).visualActors.find(actor => actor.id === id)?.activity === 'coffee', first.id);
  await capture('09-coffee-drinking.png', '同一伙伴接完咖啡后拿杯饮用');
  await report(identities[0].id, { type: 'presence', status: 'working', lastSeen: Date.now(), summary: '键盘工作验证' });
  await page.waitForFunction(id => { const actor = JSON.parse(document.querySelector('.office-scene').dataset.officeDiagnostics).visualActors.find(actor => actor.id === id); return actor.seated && actor.screen === 'working' && actor.state === 'working'; }, identities[0].id, { timeout: 30000 });
  const workBefore = await diagnostic(), frameBefore = await sceneFrame();
  await page.waitForTimeout(800); assert((await diagnostic()).renders > workBefore.renders); assert(!frameBefore.equals(await sceneFrame()));
  await capture('06-working-desk.png', '真实 presence 投影：回工位、屏幕亮、键盘动作和代码滚动');
  pass('working partner returns continuously to its own lit workstation and rendered pixels change');
  const request = await report(identities[0].id, { type: 'handoff', handoffId: 'r3-two', toBeingId: identities[1].id, mode: 'visual', durationMs: 30000, summary: '双人在白板讨论实现' });
  await page.waitForFunction(ids => { const actors = JSON.parse(document.querySelector('.office-scene').dataset.officeDiagnostics).visualActors.filter(actor => ids.includes(actor.id)); return actors.length === 2 && actors.every(actor => actor.stage === 'interacting' && actor.propId === 'collab-board') && actors.filter(actor => actor.activity === 'present').length === 1 && actors.filter(actor => actor.activity === 'listen').length === 1; }, identities.slice(0, 2).map(identity => identity.id), { timeout: 30000 });
  await capture('02-whiteboard-two.png', '授权视觉 handoff：两位关联伙伴聚到白板，一人指划、一人听；无伪造接收方业务确认');
  await report(identities[0].id, { type: 'cancel', targetEventId: request.eventId });
  pass('real visual handoff gathers two related participants at the board');
  }
  await roster(identities.slice(0, 15));
  const boardIds = [2, 7, 12].map(index => identities[index].id);
  await page.waitForFunction(ids => { const actors = JSON.parse(document.querySelector('.office-scene').dataset.officeDiagnostics).visualActors.filter(actor => ids.includes(actor.id)); return actors.length === 3 && actors.every(actor => actor.stage === 'interacting' && actor.propId === 'collab-board') && actors.filter(actor => actor.activity === 'present').length === 1 && actors.filter(actor => actor.activity === 'listen').length === 2; }, boardIds, { timeout: 40000 });
  if (!evidence.some(item => item.file === '03-whiteboard-three.png')) await capture('03-whiteboard-three.png', '三位同在白板整理思路的空闲伙伴：一人指划、两人看/点头，随后按网格换位；不是三方业务确认');
  const boardBefore = (await diagnostic()).visualActors.filter(actor => boardIds.includes(actor.id)).map(({ id, slot }) => ({ id, slot }));
  const swapped = await page.waitForFunction(before => { const scene = document.querySelector('.office-scene'); const actor = JSON.parse(scene.dataset.officeDiagnostics).visualActors.find(actor => actor.propId === 'collab-board' && actor.state === 'walking' && before.some(previous => previous.id === actor.id && previous.slot !== actor.slot)); return actor && { actor, time: Number(scene.dataset.officePoseSampledAt) }; }, boardBefore, { timeout: 15000, polling: 100 });
  const swapBefore = await swapped.jsonValue();
  const moved = await page.waitForFunction(before => { const scene = document.querySelector('.office-scene'); const actor = JSON.parse(scene.dataset.officeDiagnostics).visualActors.find(actor => actor.id === before.actor.id); return actor && (actor.x !== before.actor.x || actor.y !== before.actor.y) && { actor, time: Number(scene.dataset.officePoseSampledAt) }; }, swapBefore, { timeout: 10000, polling: 100 });
  const swapAfter = await moved.jsonValue();
  const elapsedMs = swapAfter.time - swapBefore.time;
  const distance = Math.hypot(swapAfter.actor.x - swapBefore.actor.x, swapAfter.actor.y - swapBefore.actor.y);
  assert(elapsedMs > 0 && distance > 0 && distance <= elapsedMs * 0.22 + 2, 'swap must move at walking speed, never teleport: ' + JSON.stringify({ distance, elapsedMs, swapBefore, swapAfter }));
  console.log('SWAP ' + JSON.stringify({ distance, elapsedMs }));
  pass('three board partners have one presenter and exchange positions by walking');
  await roster(identities.slice(0, 10)); pass('10 people retain distinct identities and matching workplaces');
  const seeds = [{ id: 'demo-product', name: '产品伙伴', owners: ['产品 Agent'], assignedUsers: [], color: 0xe3a35d, demo: true }, { id: 'demo-development', name: '开发伙伴', owners: ['开发 Agent'], assignedUsers: [], color: 0x6baec0, demo: true }, { id: 'demo-test', name: '测试伙伴', owners: ['测试 Agent'], assignedUsers: [], color: 0x94b879, demo: true }];
  await roster(seeds);
  await page.evaluate(async () => { const { demandNodes, getPipelineFlow } = await import('/pipeline/models/templates.ts'); const state = JSON.parse(localStorage.getItem('beings:star-map:v4')); for (const demand of state.demands) for (const node of demandNodes(getPipelineFlow(demand.workflowId), demand)) demand.nodeStates[node.id] = 'done'; localStorage.setItem('beings:star-map:v4', JSON.stringify(state)); });
  await page.reload(); await open();
  await page.waitForFunction(() => { const value = JSON.parse(document.querySelector('.office-scene').dataset.officeDiagnostics); return value.visualActors.length === 3 && value.visualActors.every(actor => actor.screen === 'done' && actor.stage === 'interacting' && actor.activity === 'phone' && actor.seated); }, undefined, { timeout: 30000 });
  await capture('07-done-empty-desk.png', '受控演示流程全部完成：Done 定格，三位伙伴离开自己的空工位坐到休息区');
  pass('Done keeps completed screens frozen and leaves empty workplaces');
  await roster(identities);
  const stressBefore = await diagnostic(); await page.waitForTimeout(4000); const stressAfter = await diagnostic();
  assert.equal(stressAfter.actors, 100); assert.equal(stressAfter.desks, 100); assert.equal(stressAfter.applications, 1); assert.equal(stressAfter.positionMismatches, 0); assert(stressAfter.renders > stressBefore.renders);
  const occupied = stressAfter.visualActors.filter(actor => actor.propId && actor.stage !== 'returning'); assert(new Set(occupied.map(actor => actor.propId + ':' + actor.slot)).size === occupied.length);
  await capture('08-hundred-people.png', '100 人实机压力：100 工位、五个场景区，容量满时其他伙伴留在各自座位等待');
  pass('100 people render and reserve unique spots without duplicating canvas or identities');
  for (const [width, height] of [[1600, 1100], [1366, 768], [1266, 823]]) {
    await session.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await page.waitForTimeout(200);
    assert(await page.locator('.office-scene').isVisible()); assert.equal(await page.locator('.office-actor-label:visible').count(), 0);
  }
  clearInterval(heartbeat);
  await page.getByLabel('减少动态效果').check();
  let settledRenders = -1; for (let attempt = 0; attempt < 40; attempt++) { const current = (await diagnostic()).renders; if (current === settledRenders) break; settledRenders = current; await page.waitForTimeout(300); }
  const reduced = await diagnostic(); await page.waitForTimeout(1200); assert.equal((await diagnostic()).renders, reduced.renders); assert.equal((await diagnostic()).ticker, false);
  await page.getByLabel('减少动态效果').uncheck(); await page.getByRole('button', { name: '画布', exact: true }).click();
  const toggle = page.locator('.office-heading > button').first();
  if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  const hidden = await diagnostic(); await page.waitForTimeout(1200); assert.equal((await diagnostic()).renders, hidden.renders); assert.equal((await diagnostic()).ticker, false);
  pass('smaller windows keep the scene readable without labels; hidden/reduced stop rendering');
  assert.deepEqual(errors, []);
  await writeFile(directory + '/verification.json', JSON.stringify({ results, errors, evidence, stress: { elapsedMs: 4000, renderDelta: stressAfter.renders - stressBefore.renders }, note: 'Actual Electron/Pixi captures on owned 9224. Controlled local fixtures; not human aesthetic acceptance or external Being production completion.' }, null, 2));
  console.log('SUMMARY ' + results.length + '/' + results.length + ' PASS');
} catch (error) {
  console.error(error);
  await writeFile(directory + '/verification.json', JSON.stringify({ results, errors, evidence, diagnostics: await diagnostic(), failure: String(error) }, null, 2));
  throw error;
} finally {
  clearInterval(heartbeat);
  const reduced = page.getByLabel('减少动态效果');
  if (await reduced.isVisible()) await reduced.check();
  for (const entry of (await page.evaluate(() => window.beings.officeSnapshot())).entries) await report(entry.identity.id, { type: 'unregister' });
  for (const entry of originalRoster) { await report(entry.identity.id, { type: 'register', identity: entry.identity }); await report(entry.identity.id, { type: 'presence', status: entry.status, lastSeen: entry.lastSeen, summary: entry.summary }); }
  await page.evaluate(state => { if (state) localStorage.setItem('beings:star-map:v4', state); else localStorage.removeItem('beings:star-map:v4'); }, originalState);
  await browser.close();
}
