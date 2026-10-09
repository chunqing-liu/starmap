import { describe, expect, it } from 'vitest';
import { createStarmapRuntime, createStarmapWorld } from '../desktop/renderer/pipeline/office/world';
import { officeRole } from '../desktop/renderer/pipeline/office/roles';
import { officeReturnRoute, officeWalkRoute, sampleOfficeWalk } from '../desktop/renderer/pipeline/office/roster-motion';
import { officeInputSchema, officeIdentitySchema } from '../desktop/shared/office';
const identities = (count: number) => Array.from({ length: count }, (_, index) => ({ id: 'person-' + index, name: '伙伴 ' + index, owners: [], assignedUsers: [], color: 0x789a87, demo: false }));

describe('adaptive procedural office', () => {
  it.each([0, 1, 2, 3, 6, 10, 100])('lays out %i actual identities with reachable non-overlapping desks', count => {
    const roster = identities(count), runtime = createStarmapRuntime(roster), world = runtime.readWorld();
    expect(world.actors).toHaveLength(count);
    expect(world.props.filter(prop => prop.templateId === 'office.workstation')).toHaveLength(count);
    expect(new Set(world.actors.map(actor => actor.homeId)).size).toBe(count);
    for (const actor of world.actors) {
      const route = officeWalkRoute(world, runtime, actor.homeId!, actor.position, true);
      expect(route.length).toBeGreaterThan(1);
      expect(sampleOfficeWalk(route, 0).done).toBe(false);
      expect(sampleOfficeWalk(route, 100000).done).toBe(true);
      expect(officeWalkRoute(world, runtime, actor.homeId!, actor.position, false).at(-1)).toEqual(route[0]);
    }
    expect(world.width).toBeLessThanOrEqual(29); expect(world.height).toBeLessThanOrEqual(80);
    runtime.dispose();
  });
  it('turns interrupted walks back from their exact visual position', () => {
    const route = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }];
    const returning = officeReturnRoute(route, 500), current = sampleOfficeWalk(route, 500);
    expect(returning[0]).toEqual({ x: current.x, y: current.y });
    expect(returning.at(-1)).toEqual(route[0]);
    expect(officeReturnRoute(route, 10000)).toEqual([...route].reverse());
  });
  it('shrinks the composition when members leave while retaining their projected status', () => {
    const previous = createStarmapWorld(identities(10)); previous.actors[0].presentation.status = 'thinking';
    const next = createStarmapWorld(identities(1), previous);
    expect(next.width).toBeLessThan(previous.width); expect(next.height).toBeLessThan(previous.height);
    expect(next.actors[0].presentation.status).toBe('thinking');
    expect(() => createStarmapWorld([...identities(1), ...identities(1)])).toThrow();
  });
  it('uses explicit role before fallback descriptions and keeps optional extension fields valid', () => {
    for (const [role, expected] of [['引擎', 'engine'], ['backend', 'backend'], ['前端', 'frontend'], ['product', 'product'], ['QA', 'test'], ['', 'general']]) {
      expect(officeRole({ ...identities(1)[0], role }).role).toBe(expected);
    }
    expect(officeRole({ ...identities(1)[0], role: 'backend', name: '渲染工具伙伴' }).role).toBe('backend');
    expect(officeRole({ ...identities(1)[0], responsibilities: '维护服务端' }).role).toBe('backend');
    expect(officeIdentitySchema.safeParse({ ...identities(1)[0], role: '引擎开发', responsibilities: '实时渲染' }).success).toBe(true);
    expect(officeIdentitySchema.safeParse({ ...identities(1)[0], role: 'x'.repeat(81) }).success).toBe(false);
  });
  it.each(['meeting-start', 'meeting-join', 'meeting-leave', 'meeting-end'])('rejects removed %s semantics at the IPC schema', type => {
    expect(officeInputSchema.safeParse({ type, eventId: 'event', beingId: 'person', runId: 'run', runOrder: 1, eventOrder: 1 }).success).toBe(false);
  });
  it('has no meeting capability but retains shared whiteboard drawing template', () => {
    const runtime = createStarmapRuntime(identities(1));
    expect(runtime.template('office.whiteboard').view).toBe('whiteboard');
    const receipt = runtime.submit({ protocolVersion: '2.0', sceneId: runtime.sceneId, commandId: 'removed', type: 'activity.start', capability: 'starmap.meeting', participants: [], params: {} });
    expect(receipt.status).toBe('rejected'); runtime.dispose();
  });
});
