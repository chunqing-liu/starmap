import { expect, it } from 'vitest';
import { createStarmapRuntime } from '../desktop/renderer/pipeline/office/world';
import { appendOfficeIdentities } from '../desktop/renderer/pipeline/office/roster';
import { DEMO_IDENTITIES } from '../desktop/renderer/pipeline/office/identities';

it('incremental registration retains actors, activities and resource owners', () => {
  const runtime = createStarmapRuntime(DEMO_IDENTITIES);
  const first = runtime.readActors()[0];
  const receipt = runtime.submit({ protocolVersion: '2.0', sceneId: runtime.sceneId, commandId: 'stay', type: 'activity.start', capability: 'office.focus', participants: [{ entityId: first.id, role: 'worker' }], params: { title: '持续工作' } });
  expect(receipt.status).toBe('completed');
  expect(runtime.readActivePhases()).toHaveLength(1);
  runtime.tick(50);
  const actors = runtime.readActors();
  const resources = runtime.snapshot().resources.filter(item => item.holders.length);
  const id = runtime.runtimeId;
  const added = { id: 'new-colleague', name: '新同事', owners: [], color: 0x426889, demo: false };
  appendOfficeIdentities(runtime, [...DEMO_IDENTITIES, added]);
  expect(runtime.runtimeId).toBe(id);
  expect(runtime.readActors().slice(0, actors.length)).toEqual(actors);
  expect(runtime.snapshot().resources.filter(item => item.holders.length)).toEqual(resources);
  expect(runtime.readActors().at(-1)?.id).toBe(added.id);
  expect(runtime.readActivePhases().length).toBe(1);
  runtime.dispose();
});

it('100 identities append in a bounded floor without moving the board', () => {
  const runtime = createStarmapRuntime(DEMO_IDENTITIES);
  const board = runtime.readWorld().props.find(prop => prop.id === 'collab-board');
  const identities = [...DEMO_IDENTITIES];
  for (let index = identities.length; index < 100; index++) {
    identities.push({ id: 'colleague-' + index, name: '同事 ' + index, owners: [], color: 0x426889, demo: false });
  }
  appendOfficeIdentities(runtime, identities);
  expect(runtime.readActors()).toHaveLength(100);
  expect(runtime.readWorld().height).toBeLessThanOrEqual(128);
  expect(runtime.readWorld().props.find(prop => prop.id === 'collab-board')).toEqual(board);
  expect(() => appendOfficeIdentities(runtime, [...identities, { id: 'overflow', name: '满额', owners: [], color: 1, demo: false }])).toThrow('ROSTER_CAPACITY');
  runtime.dispose();
});
