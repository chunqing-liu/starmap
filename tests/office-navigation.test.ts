import { expect, it } from 'vitest';
import { createStarmapRuntime } from '../desktop/renderer/pipeline/office/world';
import { DEMO_IDENTITIES } from '../desktop/renderer/pipeline/office/identities';

it('flood connectivity rejects a separated required whiteboard without weakening footprint validation', () => {
  const runtime = createStarmapRuntime(DEMO_IDENTITIES);
  const world = runtime.readWorld();
  const board = world.props.find(prop => prop.id === 'collab-board')!;
  world.blockedAreas = [{ id: 'wall', name: '隔断', bounds: { left: board.position.x - 1, top: 0, right: board.position.x, bottom: world.height } }];
  world.props = world.props.filter(prop => prop.templateId === 'office.workstation' || prop.id === 'collab-board');
  expect(() => runtime.navigation.validate(world)).toThrow('家具入口与必需互动格之间没有连通的通道');
  const overlap = runtime.readWorld(); overlap.props[1].position = overlap.props[0].position;
  expect(() => runtime.navigation.validate(overlap)).toThrow('占用了同一格');
  runtime.dispose();
});
