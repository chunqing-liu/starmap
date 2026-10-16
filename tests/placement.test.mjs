import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ bundle: true, write: false, platform: 'node', format: 'esm', stdin: { contents: 'export * from "./src/placement"; export * from "./src/layout-observer";', resolveDir: fileURLToPath(new URL('../', import.meta.url)) } });
const { findVacantPosition, frameResizeObserver } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const separate = (first, second) => first.x + first.width + 20 <= second.x || first.x >= second.x + second.width + 20 || first.y + first.height + 20 <= second.y || first.y >= second.y + second.height + 20;

test('新增布局：空白位置不移动', () => {
  assert.deepEqual(findVacantPosition({ x: 100, y: 100, width: 214, height: 86 }, []), { x: 100, y: 100 });
});
test('新增布局：16 个相同中心快速新增节点互不堆叠，位置确定', () => {
  const nodes = [], candidate = { x: 500, y: 300, width: 214, height: 86 };
  for (let index = 0; index < 16; index++) {
    const first = findVacantPosition(candidate, nodes), second = findVacantPosition(candidate, nodes);
    assert.deepEqual(first, second);
    const placed = { ...candidate, ...first }; assert(nodes.every(node => separate(placed, node))); nodes.push(placed);
  }
  assert.equal(new Set(nodes.map(node => node.x + ',' + node.y)).size, 16);
});
test('新增布局：节点和闸口避开站容器，不覆盖容器内节点', () => {
  const station = { x: -200, y: -100, width: 286, height: 720 }, node = { x: -176, y: 12, width: 214, height: 86 };
  const candidate = { x: -150, y: 40, width: 214, height: 86 };
  const placed = { ...candidate, ...findVacantPosition(candidate, [station, node]) };
  assert(separate(placed, station)); assert(separate(placed, node));
});
test('新增布局：站尺寸参与避让，不改动原有几何', () => {
  const obstacles = [{ x: 20, y: 30, width: 214, height: 86 }, { x: 20, y: 180, width: 286, height: 152 }];
  const before = structuredClone(obstacles), candidate = { x: 40, y: 60, width: 286, height: 152 };
  const placed = { ...candidate, ...findVacantPosition(candidate, obstacles) };
  assert(obstacles.every(obstacle => separate(placed, obstacle))); assert.deepEqual(obstacles, before);
});

test('尺寸通知：布局更新延后到下一帧，同一目标只保留最新测量，不吞异常', () => {
  const callbacks = [], frames = new Map(); let handle = 0, native;
  class Native { constructor(callback) { native = callback; } observe() {} unobserve() {} disconnect() {} }
  const Observer = frameResizeObserver(Native, { request(callback) { frames.set(++handle, callback); return handle; }, cancel(identifier) { frames.delete(identifier); } });
  const target = {}, observer = new Observer((entries, self) => callbacks.push({ entries, self })); observer.observe(target);
  native([{ target, width: 1 }]); native([{ target, width: 2 }]); assert.equal(callbacks.length, 0); assert.equal(frames.size, 1);
  frames.get(1)(); assert.equal(callbacks[0].entries[0].width, 2); assert.equal(callbacks[0].self, observer);
  const failure = new Observer(() => { throw new Error('real layout failure'); }); failure.observe(target); native([{ target }]);
  assert.throws(() => frames.get(2)(), /real layout failure/);
});
test('尺寸通知：unobserve/disconnect 取消陈旧测量，重新观察可继续', () => {
  const frames = new Map(); let handle = 0, native, delivered = 0;
  class Native { constructor(callback) { native = callback; } observe() {} unobserve() {} disconnect() {} }
  const Observer = frameResizeObserver(Native, { request(callback) { frames.set(++handle, callback); return handle; }, cancel(identifier) { frames.delete(identifier); } });
  const target = {}, observer = new Observer(() => delivered++); observer.observe(target); native([{ target }]); observer.unobserve(target); frames.get(1)(); assert.equal(delivered, 0);
  observer.observe(target); native([{ target }]); observer.disconnect(); assert(!frames.has(2));
  observer.observe(target); native([{ target }]); frames.get(3)(); assert.equal(delivered, 1);
});
