import { describe, expect, it } from 'vitest';
import { OfficeLeisure, ACTIVITY_SPOT, leisureTarget, leisureRoute, officeRouteFromPixel } from '../desktop/renderer/pipeline/office/leisure';
import { OfficeDiscussion } from '../desktop/renderer/pipeline/office/discussion';
import { SPOT_CAPACITY, SPOT_IDS, spotCell } from '../desktop/renderer/pipeline/office/scene-objects';
import { createStarmapRuntime } from '../desktop/renderer/pipeline/office/world';
import { DEMO_IDENTITIES } from '../desktop/renderer/pipeline/office/identities';
import { cellCenter, seatPixels } from '../desktop/renderer/pipeline/office/vendor/scene/gridProjection';
import { HandoffController } from '../desktop/renderer/pipeline/office/handoff';

const identities = (count: number) => Array.from({ length: count }, (_, index) => ({ ...DEMO_IDENTITIES[index % 3], id: 'p6r3-' + index, demo: false }));

describe('P6R3 scene behavior chains', () => {
  it.each([0, 1, 2, 3, 6, 10, 100])('has five real scene objects and reachable interaction slots with %i people', count => {
    const runtime = createStarmapRuntime(identities(count)), world = runtime.readWorld();
    expect(world.props.filter(prop => prop.templateId !== 'office.workstation')).toHaveLength(5);
    for (const [spot, capacity] of Object.entries(SPOT_CAPACITY)) {
      expect(world.props.some(prop => prop.id === SPOT_IDS[spot as keyof typeof SPOT_IDS])).toBe(true);
      for (let slot = 0; slot < capacity; slot++) expect(runtime.navigation.walkable(world, spotCell(world, spot as keyof typeof SPOT_IDS, slot))).toBe(true);
    }
    for (const actor of world.actors) for (const activity of ['phone', 'coffee', 'wander', 'exercise', 'read'] as const) {
      const destination = leisureTarget(world, 0, activity), route = leisureRoute(world, runtime, actor.position, destination, actor.homeId);
      expect(route.at(-1)).toEqual(cellCenter(destination));
      for (let index = 1; index < route.length; index++) expect(route[index].x === route[index - 1].x || route[index].y === route[index - 1].y).toBe(true);
    }
    runtime.dispose();
  });
  it('starts at the seat, rises, walks continuously, then pours before drinking', () => {
    const runtime = createStarmapRuntime(identities(2)), world = runtime.readWorld(), actor = world.actors[1], leisure = new OfficeLeisure();
    const sample = (time: number) => leisure.sample(actor.id, 1, world, runtime, actor.homeId!, actor.position, time, true, false)!;
    expect(sample(0)).toMatchObject({ ...seatPixels(actor.position), stage: 'rising', walking: false });
    const first = sample(500), second = sample(600);
    expect(first.walking).toBe(true); expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeLessThanOrEqual(22.01);
    const arrived = sample(15000); expect(arrived).toMatchObject({ stage: 'interacting', activity: 'brew', propId: SPOT_IDS.coffee });
    expect({ x: arrived.x, y: arrived.y }).toEqual(cellCenter(spotCell(world, 'coffee', 0)));
    expect(sample(19500).activity).toBe('coffee');
    runtime.dispose();
  });
  it('docks arbitrary walking pixels orthogonally and leaves a waiting seat stationary', () => {
    const runtime = createStarmapRuntime(identities(1)), world = runtime.readWorld(), actor = world.actors[0], home = seatPixels(actor.position);
    expect(officeRouteFromPixel(world, runtime, home, actor.position, actor.homeId!, true)).toEqual([home]);
    const route = officeRouteFromPixel(world, runtime, { x: home.x + 7, y: home.y - 9 }, spotCell(world, 'coffee', 0), actor.homeId!);
    for (let index = 1; index < route.length; index++) expect(route[index].x === route[index - 1].x || route[index].y === route[index - 1].y).toBe(true);
    runtime.dispose();
  });
  it('copies renderer accessor coordinates and walks through a discussion swap without a zero-position jump', () => {
    const runtime = createStarmapRuntime(identities(3)), world = runtime.readWorld(), actor = world.actors[0], discussion = new OfficeDiscussion();
    const initial = cellCenter(spotCell(world, 'board', 0));
    const current = Object.defineProperties({}, { x: { get: () => initial.x }, y: { get: () => initial.y } }) as { x: number; y: number };
    expect(officeRouteFromPixel(world, runtime, current, spotCell(world, 'board', 0), actor.homeId!)).toEqual([initial]);
    const group = world.actors.map(item => item.id), home = actor.position;
    expect(discussion.sample(actor.id, group, world, runtime, actor.homeId!, home, current, 1000, false)).toMatchObject(initial);
    const started = discussion.sample(actor.id, group, world, runtime, actor.homeId!, home, current, 11000, false)!;
    expect(started).toMatchObject({ ...initial, walking: true, slot: 1 });
    const moved = discussion.sample(actor.id, group, world, runtime, actor.homeId!, home, current, 11100, false)!;
    expect(Math.hypot(moved.x - initial.x, moved.y - initial.y)).toBeCloseTo(22);
    expect(discussion.sample(actor.id, group, world, runtime, actor.homeId!, home, current, 11100, true)).toMatchObject(initial);
    runtime.dispose();
  });
  it.each([['phone', 0], ['exercise', 3], ['read', 4]] as const)('aligns %s with its prop and correct sitting posture', (activity, index) => {
    const runtime = createStarmapRuntime(identities(5)), world = runtime.readWorld(), actor = world.actors[index], leisure = new OfficeLeisure();
    leisure.sample(actor.id, index, world, runtime, actor.homeId!, actor.position, 0, true, false);
    const pose = leisure.sample(actor.id, index, world, runtime, actor.homeId!, actor.position, 15000, true, false)!;
    expect(pose.activity).toBe(activity); expect(pose.propId).toBe(SPOT_IDS[ACTIVITY_SPOT[activity]]); expect(pose.seated).toBe(activity !== 'exercise');
    runtime.dispose();
  });
  it('interrupts leisure for work at the exact current position, then releases the scene slot', () => {
    const runtime = createStarmapRuntime(identities(1)), world = runtime.readWorld(), actor = world.actors[0], leisure = new OfficeLeisure();
    leisure.sample(actor.id, 0, world, runtime, actor.homeId!, actor.position, 0, true, false);
    const current = leisure.sample(actor.id, 0, world, runtime, actor.homeId!, actor.position, 1500, true, false)!;
    const returning = leisure.sample(actor.id, 0, world, runtime, actor.homeId!, actor.position, 1500, false, false)!;
    expect(returning).toMatchObject({ x: current.x, y: current.y, returning: true, stage: 'returning' });
    expect(leisure.sample(actor.id, 0, world, runtime, actor.homeId!, actor.position, 15000, false, false)).toBeUndefined(); expect(leisure.has(actor.id)).toBe(false);
    runtime.dispose();
  });
  it('holds the Done workstation briefly, then leaves for the sofa without teleporting', () => {
    const runtime = createStarmapRuntime(identities(1)), world = runtime.readWorld(), actor = world.actors[0], leisure = new OfficeLeisure();
    const sample = (time: number) => leisure.sample(actor.id, 0, world, runtime, actor.homeId!, actor.position, time, true, false, false, undefined, 0, true)!;
    expect(sample(1700).stage).toBe('rising'); expect(sample(3400).walking).toBe(false);
    expect(sample(3700).walking).toBe(true); expect(sample(20000)).toMatchObject({ activity: 'phone', seated: true, propId: SPOT_IDS.rest });
    runtime.dispose();
  });
  it('caps occupancy and keeps waiting partners on their own seats under 100-person load', () => {
    const runtime = createStarmapRuntime(identities(100)), world = runtime.readWorld(), leisure = new OfficeLeisure();
    world.actors.forEach((actor, index) => leisure.sample(actor.id, index, world, runtime, actor.homeId!, actor.position, 0, true, false));
    const poses = world.actors.map((actor, index) => leisure.sample(actor.id, index, world, runtime, actor.homeId!, actor.position, 30000, true, false)!);
    const occupied = poses.filter(pose => pose.slot! >= 0);
    expect(new Set(occupied.map(pose => pose.propId + ':' + pose.slot)).size).toBe(occupied.length);
    expect(occupied.length).toBeLessThanOrEqual(12);
    expect(poses.filter(pose => pose.stage === 'waiting').length).toBeGreaterThan(70);
    leisure.retain(world.actors.slice(0, 3).map(actor => actor.id)); expect(leisure.has(world.actors[99].id)).toBe(false);
    runtime.dispose();
  });
  it('freezes reduced motion and pauses the behavior clock while the office is hidden', () => {
    const runtime = createStarmapRuntime(identities(1)), world = runtime.readWorld(), actor = world.actors[0], leisure = new OfficeLeisure();
    const sample = (time: number, reduced = false) => leisure.sample(actor.id, 0, world, runtime, actor.homeId!, actor.position, time, true, reduced)!;
    sample(0); const before = sample(1000); leisure.setPaused(true, 1000); expect(sample(60000)).toEqual(before);
    leisure.setPaused(false, 60000); expect(sample(60000)).toEqual(before);
    const frozen = sample(60100, true); expect(sample(90000, true)).toEqual(frozen);
    runtime.dispose();
  });
  it.each([2, 3])('gathers %i partners at unique whiteboard slots, exchanges positions by walking, and returns continuously', count => {
    const runtime = createStarmapRuntime(identities(count)), world = runtime.readWorld(), discussion = new OfficeDiscussion(), group = world.actors.map(actor => actor.id);
    const start = world.actors.map(actor => discussion.sample(actor.id, group, world, runtime, actor.homeId!, actor.position, seatPixels(actor.position), 0, false)!);
    const arrived = world.actors.map((actor, index) => discussion.sample(actor.id, group, world, runtime, actor.homeId!, actor.position, start[index], 6000, false)!);
    expect(arrived.every(pose => pose.stage === 'interacting')).toBe(true); expect(arrived.filter(pose => pose.activity === 'present')).toHaveLength(1); expect(arrived.filter(pose => pose.activity === 'listen')).toHaveLength(count - 1);
    const swap = discussion.sample(group[0], group, world, runtime, world.actors[0].homeId!, world.actors[0].position, arrived[0], 11000, false)!;
    expect(swap.walking).toBe(true); expect({ x: swap.x, y: swap.y }).toEqual({ x: arrived[0].x, y: arrived[0].y });
    const returning = discussion.sample(group[0], [], world, runtime, world.actors[0].homeId!, world.actors[0].position, swap, 11000, false)!; expect(returning).toMatchObject({ x: swap.x, y: swap.y, returning: true });
    runtime.dispose();
  });
  it('routes authorized handoffs to the actual whiteboard, without manufacturing receiver speech', () => {
    const runtime = createStarmapRuntime(DEMO_IDENTITIES), controller = new HandoffController(runtime); controller.setEnabled(true);
    controller.receive({ type: 'handoff', eventId: 'p6r3-discussion', handoffId: 'p6r3-discussion', beingId: DEMO_IDENTITIES[0].id, toBeingId: DEMO_IDENTITIES[1].id, runId: 'p6r3', runOrder: 1, eventOrder: 1, mode: 'visual', summary: '在白板讨论实现', durationMs: 15000 });
    const plan = runtime.snapshot().activities[0].plan;
    expect(plan.phases[0].moves!.every(move => move.targetId === SPOT_IDS.board)).toBe(true);
    expect(plan.phases.flatMap(phase => phase.speech || []).some(speech => speech.actorId === DEMO_IDENTITIES[1].id)).toBe(false);
    controller.dispose(); runtime.dispose();
  });
});
