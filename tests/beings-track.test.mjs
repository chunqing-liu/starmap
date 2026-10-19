import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ bundle: true, write: false, platform: 'node', format: 'esm', stdin: { contents: 'export * from "./src/models/beings-development"; export * from "./src/models/schema";', resolveDir: fileURLToPath(new URL('../', import.meta.url)) } });
const m = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const flow = m.beingsDevelopmentWorkflow;
const node = (id) => flow.nodes.find((n) => n.id === id);
const station = (id) => flow.stations.find((s) => s.id === id);

test('默认流程分两条轨：开发闭环与上线准出互不阻塞', () => {
  const dev = flow.nodes.filter((n) => n.track === 'dev').map((n) => n.id);
  const release = flow.nodes.filter((n) => n.track === 'release').map((n) => n.id);
  for (const id of ['N11', 'H3', 'N04', 'N05']) assert.ok(dev.includes(id), `开发闭环应包含 ${id}`);
  for (const id of ['N11', 'H3']) assert.ok(!release.includes(id), `上线准出不该等 ${id}`);
  for (const id of ['H2', 'N06', 'N07', 'H4']) assert.ok(release.includes(id), `上线准出应包含 ${id}`);
  for (const id of ['H2', 'N06', 'H4']) assert.ok(!dev.includes(id), `开发闭环不该被 ${id} 阻塞`);
});

test('需求入口是两条轨共用，不标轨', () => {
  assert.equal(node('N01').track, undefined);
  assert.equal(node('N02').track, 'dev');
  assert.equal(node('H1').track, undefined);
});

test('发布站不参与闭环判定', () => {
  for (const id of ['N08', 'N09', 'N10']) assert.equal(node(id).track, undefined, `${id} 发生在准出之后，不标轨`);
  assert.equal(station('S06').track, undefined);
});

test('站上的轨标记与站内节点一致', () => {
  assert.equal(station('S03').track, 'dev');
  assert.equal(station('S04').track, 'dev');
  assert.equal(station('S05').track, 'release');
  assert.deepEqual(station('S03').nodeIds, ['N03']);
  assert.ok(station('S04').nodeIds.includes('N11'));
});

test('交付核验 N11 接在实现审核 H3 之后', () => {
  assert.equal(node('N11').stationId, 'S04');
  const edge = flow.transitions.find((t) => t.fromNode === 'H3' && t.toNode === 'N11');
  assert.ok(edge, 'H3 通过后应进入交付核验');
  assert.equal(edge.event, '通过');
  assert.ok(flow.layout.N11, '画布坐标要有 N11，否则节点落在原点');
});

test('正式测试驱动的返修才挂失败报告，默认不预填假报告', () => {
  assert.equal(node('N07').repairKind, 'formal_test');
  assert.equal(node('N07').relatedReport, undefined);
});

test('默认模板记录规范版本，已发送与已采用分开', () => {
  assert.deepEqual(flow.specVersion, {
    bundle: 'provider-team-independent-testing-20261019',
    transitions: '4.0.0',
    reviewGates: '2.0.0',
    loadedAt: '2026-10-19',
  });
  assert.ok(m.CLOSURE_TRACKS.includes('dev') && m.CLOSURE_TRACKS.includes('release'));
});
test('开发自测 N12 在开发闭环内，接在代码评审后、实现审核前', () => {
  assert.equal(node('N12').stationId, 'S04');
  assert.equal(node('N12').track, 'dev');
  assert.ok(flow.transitions.some((t) => t.fromNode === 'N05' && t.toNode === 'N12'));
  assert.ok(flow.transitions.some((t) => t.fromNode === 'N12' && t.toNode === 'H3'));
  assert.ok(!flow.nodes.filter((n) => n.track === 'dev').map((n) => n.id).includes('N06'), '开发闭环不等正式测试');
});

test('实现审核 H3 向正式测试输出固定候选', () => {
  const edge = flow.transitions.find((t) => t.fromNode === 'H3' && t.toNode === 'N06');
  assert.ok(edge, 'H3 应把固定候选交给测试执行');
  assert.equal(edge.event, '固定候选');
  assert.match(node('N06').description, /固定开发候选/);
});

test('测试设计是有作者的节点，H2 退回能回到设计人手上', () => {
  assert.equal(node('N13').stationId, 'S02');
  assert.deepEqual(station('S02').nodeIds, ['N02', 'N13', 'H2']);
  assert.ok(flow.transitions.some((t) => t.fromNode === 'N02' && t.toNode === 'N13'));
  assert.ok(flow.transitions.some((t) => t.fromNode === 'N13' && t.toNode === 'H2'));
  const back = flow.transitions.find((t) => t.fromNode === 'H2' && t.toNode === 'N13');
  assert.ok(back, 'H2 退回应落到测试设计');
  assert.equal(back.event, '退回');
});

test('H2/H3 默认自动判定，H1/H4 仍然人工', () => {
  assert.equal(node('H2').requires_human_review, false);
  assert.equal(node('H3').requires_human_review, false);
  assert.equal(node('H1').requires_human_review, true);
  assert.equal(node('H4').requires_human_review, true);
  assert.match(node('H3').description, /高风险/);
});

test('证据绑定版本、返修保留原快照', () => {
  assert.match(node('N11').description, /版本/);
  assert.match(node('N11').description, /复用/);
  assert.match(node('N07').description, /快照/);
  assert.match(node('N07').description, /受影响项/);
});
