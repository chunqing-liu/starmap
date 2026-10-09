import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const endpoint = process.env.OFFICE_CDP_URL || 'http://127.0.0.1:9224';
assert.equal(new URL(endpoint).port, '9224');
const version = process.env.OFFICE_CAPTURE_VERSION || 'after';
assert(['before', 'after'].includes(version));
const directory = 'desktop/renderer/pipeline/office/p6r4-screenshots';
await mkdir(directory, { recursive: true });
const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('http://localhost:5176/'));
assert(page, 'P6R4 requires its owned development renderer');
const errors = [], evidence = [], runOrder = Date.now();
let eventOrder = 0;
page.on('pageerror', error => errors.push(error.message));
const diagnostics = () => page.locator('.office-scene').evaluate(element => JSON.parse(element.dataset.officeDiagnostics));
const report = async (beingId, fields) => {
  const receipt = await page.evaluate(input => window.beings.officeTestInject(input), { beingId, runId: 'p6r4-' + runOrder, runOrder, eventId: 'p6r4-' + runOrder + '-' + ++eventOrder, eventOrder, ...fields });
  assert(receipt.accepted, JSON.stringify(receipt));
};
const open = async () => {
  await page.locator('#options-home button').filter({ hasText: '小镇' }).evaluate(button => button.click());
  await page.locator('.place-switcher button').filter({ hasText: '星图' }).click();
  const standalone = page.getByRole('button', { name: '关闭独立协作舱', exact: true });
  if (await standalone.isVisible()) await standalone.click();
  await page.getByRole('button', { name: '办公室 · 实验', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.office-scene')?.dataset.officeDiagnostics);
};
const capture = async name => {
  const file = version + '-' + name + '.png';
  await page.locator('.office-scene').screenshot({ path: directory + '/' + file });
  evidence.push({ file, capturedAt: new Date().toISOString(), diagnostics: await diagnostics() });
  console.log('CAPTURE ' + file);
};
try {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
  await open(); await page.getByLabel('减少动态效果').check();
  for (const entry of (await page.evaluate(() => window.beings.officeSnapshot())).entries) await report(entry.identity.id, { type: 'unregister' });
  for (let index = 0; index < 6; index++) {
    const identity = { id: 'p6r4-person-' + index, name: '返修伙伴 ' + (index + 1), role: '开发', owners: [], assignedUsers: [], color: 0x759cc4, demo: false };
    await report(identity.id, { type: 'register', identity });
    await report(identity.id, { type: 'presence', status: 'idle', lastSeen: Date.now(), summary: '' });
  }
  await page.reload(); await open(); await page.getByLabel('减少动态效果').uncheck();
  await page.waitForFunction(() => { const actors = JSON.parse(document.querySelector('.office-scene').dataset.officeDiagnostics).visualActors; return actors.length === 6 && actors.every(actor => actor.stage === 'interacting') && actors.some(actor => actor.activity === 'brew'); }, undefined, { timeout: 40000 });
  await capture('reach-01'); await page.waitForTimeout(400); await capture('reach-02');
  await page.waitForFunction(() => JSON.parse(document.querySelector('.office-scene').dataset.officeDiagnostics).visualActors.some(actor => actor.activity === 'coffee'), undefined, { timeout: 15000 });
  await capture('coffee');
  await report('p6r4-person-0', { type: 'handoff', handoffId: 'p6r4-board-' + runOrder, toBeingId: 'p6r4-person-1', mode: 'visual', durationMs: 30000, summary: '伸手指划验证' });
  await page.waitForFunction(() => JSON.parse(document.querySelector('.office-scene').dataset.officeDiagnostics).visualActors.some(actor => actor.activity === 'present'), undefined, { timeout: 30000 });
  await capture('present');
  const frames = await page.evaluate(async () => {
    const source = await (await fetch('/pipeline/office/textures.ts')).text();
    const pixi = await import(source.match(/from "([^"]+)"/)[1]);
    const { Application, Sprite, Text, Rectangle } = pixi.default || pixi;
    const { OfficeTextures } = await import('/pipeline/office/textures.ts');
    const application = new Application();
    await application.init({ width: 960, height: 800, background: 0xe8ece6, resolution: 1 });
    const textures = new OfficeTextures(application.renderer);
    for (const [row, action] of ['brew', 'present', 'phone', 'coffee', 'read', 'exercise', 'working', 'thinking'].entries()) {
      const label = new Text({ text: action, style: { fontSize: 18, fill: 0x354348 } });
      label.position.set(12, row * 100 + 40); application.stage.addChild(label);
      for (let frame = 0; frame < 4; frame++) {
        const state = action === 'working' || action === 'thinking' ? action : 'idle';
        const sprite = new Sprite(textures.actor(state, frame, 0x759cc4, ['phone', 'read', 'working', 'thinking'].includes(action), 'front', 1, state === 'idle' ? action : undefined));
        sprite.scale.set(2); sprite.position.set(130 + frame * 205, row * 100 + 8); application.stage.addChild(sprite);
      }
    }
    const image = await application.renderer.extract.base64({ target: application.stage, frame: new Rectangle(0, 0, 960, 800), clearColor: 0xe8ece6, format: 'png' });
    application.destroy(); textures.dispose();
    return image;
  });
  await writeFile(directory + '/' + version + '-frames.png', Buffer.from(frames.split(',')[1], 'base64'));
  assert.equal(errors.length, 0, errors.join(' | '));
  await writeFile(directory + '/' + version + '-runtime.json', JSON.stringify({ version, runOrder, endpoint, evidence, errors }, null, 2) + String.fromCharCode(10));
  console.log('PASS real scene reach, drinking, presentation and four-frame texture evidence');
} finally { await browser.close(); }
