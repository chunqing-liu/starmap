import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.env.OFFICE_CDP_URL || 'http://127.0.0.1:9224';
assert(!url.includes(':9223'), 'Never use the human partner instance');
const browser = await chromium.connectOverCDP(url);
const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('http://localhost:') || candidate.url().startsWith('http://127.0.0.1:') || candidate.url().startsWith('beings://desktop'));
assert(page, 'An isolated office renderer is required');
const errors = [], results = [], orders = new Map(), runOrder = Date.now();
page.on('pageerror', error => errors.push(error.message));
const originalState = await page.evaluate(() => localStorage.getItem('beings:star-map:v4'));
const originalRoster = (await page.evaluate(() => window.beings.officeSnapshot())).entries;
const report = async (beingId, fields) => {
  const eventOrder = (orders.get(beingId) || 0) + 1; orders.set(beingId, eventOrder);
  const input = { beingId, eventId: 'r2-' + runOrder + '-' + beingId + '-' + eventOrder, runId: 'r2-' + runOrder, runOrder, eventOrder, ...fields };
  const result = await page.evaluate(input => { if (input.type === 'presence') input.lastSeen = Date.now(); return window.beings.officeTestInject(input); }, input);
  assert(result.accepted, JSON.stringify(result)); return result;
};
const diagnostic = () => page.locator('.office-scene').evaluate(element => JSON.parse(element.dataset.officeDiagnostics));
const settled = () => page.waitForFunction(() => { const value = JSON.parse(document.querySelector('.office-scene').dataset.officeDiagnostics); return !value.transitions && !value.leisureMoving && value.visualActors.every(actor => actor.activity && actor.activity !== 'brew'); }, undefined, { timeout: 60000 });
const pass = label => { results.push(label); console.log('PASS ' + label); };
const open = async () => {
  await page.locator('#options-home button').filter({ hasText: '小镇' }).evaluate(button => button.click());
  await page.locator('.place-switcher button').filter({ hasText: '星图' }).click();
  await page.getByRole('button', { name: '办公室 · 实验', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.office-scene')?.dataset.officeDiagnostics);
};
const directory = 'p6r2-screenshots';
const session = await page.context().newCDPSession(page);
const viewport = (width, height) => session.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
const identities = Array.from({ length: 10 }, (_, index) => ({ id: 'r2-person-' + index, name: ['林 · 引擎', '陈 · 后端', '周 · 前端', '许 · 产品', '何 · 测试', '吴 · 后端'][index % 6], role: ['引擎开发', '后端开发', '前端开发', '产品', '测试', '后端开发'][index % 6], owners: [], assignedUsers: [], color: [0x759cca, 0x91b3a2, 0xae9bc5, 0xdfb77d, 0x7eb2c3, 0x9eaad1][index % 6], demo: false }));
const heartbeat = setInterval(async () => {
  for (const entry of (await page.evaluate(() => window.beings.officeSnapshot())).entries.filter(entry => identities.some(identity => identity.id === entry.identity.id))) await report(entry.identity.id, { type: 'presence', status: entry.status, lastSeen: Date.now(), summary: entry.summary });
}, 10000);
try {
  await mkdir(directory, { recursive: true });
  await viewport(1600, 1100);
  await page.evaluate(() => { localStorage.removeItem('beings:star-map:v4'); localStorage.setItem('starmap-office-open', 'true'); localStorage.setItem('starmap-office-reduced', 'false'); });
  await page.reload({ waitUntil: 'domcontentloaded' }); await open();
  await page.locator('.office-task-list > button').first().click();
  assert(await page.getByRole('region', { name: '办公室任务详情' }).isVisible());
  assert.equal(await page.locator('.star-map-canvas').isVisible(), false);
  await page.locator('.office-review').click();
  assert.equal(await page.locator('.star-map-canvas').isVisible(), false);
  await page.screenshot({ path: directory + '/after-00-local-task-detail.png' });
  pass('Task and review clicks stay in office; details open locally');
  await page.getByRole('button', { name: '在画布中打开', exact: true }).click();
  assert(await page.locator('.star-map-canvas').isVisible());
  pass('Only explicit canvas navigation switches views');
  await page.getByRole('button', { name: '办公室 · 实验', exact: true }).click();
  for (const entry of originalRoster) await report(entry.identity.id, { type: 'unregister' });
  await page.waitForFunction(() => JSON.parse(document.querySelector('.office-scene').dataset.officeDiagnostics).actors === 0);
  assert.equal((await diagnostic()).desks, 0); pass('Empty roster has no phantom people or desks');
  for (const identity of identities.slice(0, 6)) { await report(identity.id, { type: 'register', identity }); await report(identity.id, { type: 'presence', status: 'idle', lastSeen: Date.now(), summary: '' }); }
  await settled();
  const idle = await diagnostic(); assert.equal(idle.actors, 6); assert.equal(idle.desks, 6);
  assert(idle.visualActors.every(actor => actor.screen === 'off' && actor.stage === 'interacting'));
  assert.deepEqual(new Set(idle.visualActors.map(actor => actor.activity)), new Set(['phone', 'coffee', 'wander', 'exercise', 'read']));
  await page.locator('.office-scene').screenshot({ path: directory + '/after-01-six-idle.png' });
  pass('Six people, six dark desks; all five leisure props visible off the seats');
  const identity = identities[0], activity = idle.visualActors[0].activity;
  await page.waitForFunction(({ id, activity }) => { const actor = JSON.parse(document.querySelector('.office-scene').dataset.officeDiagnostics).visualActors.find(actor => actor.id === id); return actor.activity && actor.activity !== activity; }, { id: identity.id, activity }, { timeout: 45000 });
  await page.locator('.office-scene').screenshot({ path: directory + '/after-02-activity-switch.png' });
  pass('The same idle partner naturally changes activity over time');
  await report(identity.id, { type: 'presence', status: 'working', lastSeen: Date.now(), summary: '编译实时图形' });
  await page.waitForFunction(id => { const actor = JSON.parse(document.querySelector('.office-scene').dataset.officeDiagnostics).visualActors.find(actor => actor.id === id); return actor.screen === 'working' && actor.seated; }, identity.id, { timeout: 20000 });
  assert.notEqual((await diagnostic()).visualActors[0].facing, 'back');
  await page.locator('.office-scene').screenshot({ path: directory + '/after-03-working.png' });
  pass('Work recalls the partner to their desk; lit monitor and camera-facing three-quarter pose');
  await report(identity.id, { type: 'presence', status: 'idle', lastSeen: Date.now(), summary: '' });
  await page.waitForFunction(() => JSON.parse(document.querySelector('.office-scene').dataset.officeDiagnostics).visualActors.every(actor => actor.screen === 'off' && actor.stage === 'interacting'));
  await settled();
  assert((await diagnostic()).visualActors.every(actor => actor.screen === 'off' && actor.stage === 'interacting'));
  for (const identity of identities.slice(6)) { await report(identity.id, { type: 'register', identity }); await report(identity.id, { type: 'presence', status: 'idle', lastSeen: Date.now(), summary: '' }); }
  await page.waitForFunction(() => JSON.parse(document.querySelector('.office-scene').dataset.officeDiagnostics).actors === 10);
  await settled(); const ten = await diagnostic();
  assert.equal(ten.desks, 10); assert.equal(new Set(ten.visualActors.map(actor => actor.x + ':' + actor.y)).size, 10);
  await page.locator('.office-scene').screenshot({ path: directory + '/after-04-ten-people.png' });
  pass('Multiple developers keep distinct identities, workplaces and leisure positions');
  for (const identity of identities) await report(identity.id, { type: 'unregister' });
  for (const entry of originalRoster) { await report(entry.identity.id, { type: 'register', identity: entry.identity }); await report(entry.identity.id, { type: 'presence', status: 'idle', lastSeen: 0, summary: '演示绑定 · 来自流程状态' }); }
  await page.evaluate(async () => { const { demandNodes, getPipelineFlow } = await import('/pipeline/models/templates.ts'); const state = JSON.parse(localStorage.getItem('beings:star-map:v4')); state.demands.forEach(demand => { demandNodes(getPipelineFlow(demand.workflowId), demand).forEach(node => { demand.nodeStates[node.id] = 'done'; }); }); localStorage.setItem('beings:star-map:v4', JSON.stringify(state)); });
  await page.reload({ waitUntil: 'domcontentloaded' }); await open();
  await page.waitForFunction(count => { const value = JSON.parse(document.querySelector('.office-scene').dataset.officeDiagnostics); return count > 0 && value.actors === count && value.visualActors.every(actor => actor.screen === 'done'); }, originalRoster.length);
  await settled();
  await page.locator('.office-scene').screenshot({ path: directory + '/after-05-done.png' });
  pass('Completed workflow projects Done to actual workstation screens without pretending the people are working');
  for (const [width, height] of [[1600, 1100], [1366, 768], [1266, 823]]) {
    await viewport(width, height); await page.waitForTimeout(250);
    assert(await page.locator('.office-scene').isVisible()); assert(await page.locator('.office-people').isVisible());
    const labels = await page.locator('.office-labels').evaluate(element => [...element.children].filter(label => !label.hidden).map(label => ({ left: parseFloat(label.style.left), top: parseFloat(label.style.top), right: parseFloat(label.style.left) + label.offsetWidth, bottom: parseFloat(label.style.top) + label.offsetHeight, width: element.clientWidth, height: element.clientHeight })));
    assert(labels.length <= (await diagnostic()).actors);
    assert(labels.every(label => label.left >= 0 && label.top >= 0 && label.right <= label.width && label.bottom <= label.height));
  }
  await page.screenshot({ path: directory + '/after-06-small-window.png' });
  pass('Normal and smaller windows retain roster, local details and in-bounds labels');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(300);
  const reduced = await diagnostic(); await page.waitForTimeout(1800);
  assert.equal((await diagnostic()).renders, reduced.renders); assert.equal((await diagnostic()).ticker, false); assert.equal((await diagnostic()).breathing, false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: '返回画布', exact: true }).click();
  await page.locator('.office-heading > button').first().click();
  const hidden = await diagnostic(); await page.waitForTimeout(1800); assert.equal((await diagnostic()).renders, hidden.renders);
  pass('Reduced motion and hidden office have no continuing renders');
  assert.equal(errors.length, 0, errors.join(' | '));
  await writeFile(directory + '/verification.json', JSON.stringify({ results, errors, viewport: [1600, 1100], identities: identities.map(identity => ({ id: identity.id, role: identity.role })) }, null, 2));
  console.log('SUMMARY ' + results.length + '/' + results.length + ' PASS');
} finally {
  clearInterval(heartbeat);
  for (const entry of (await page.evaluate(() => window.beings.officeSnapshot())).entries.filter(entry => identities.some(identity => identity.id === entry.identity.id))) await report(entry.identity.id, { type: 'unregister' });
  for (const entry of originalRoster) { await report(entry.identity.id, { type: 'register', identity: entry.identity }); await report(entry.identity.id, { type: 'presence', status: entry.status, lastSeen: entry.lastSeen, summary: entry.summary }); }
  await page.evaluate(originalState => { if (originalState) localStorage.setItem('beings:star-map:v4', originalState); else localStorage.removeItem('beings:star-map:v4'); }, originalState);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await browser.close();
}
