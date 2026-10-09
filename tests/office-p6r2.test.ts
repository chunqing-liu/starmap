import { describe, expect, it } from 'vitest';
import { OfficeLeisure, LEISURE_ACTIVITIES, leisureRoute, leisureTarget } from '../desktop/renderer/pipeline/office/leisure';
import { createStarmapRuntime } from '../desktop/renderer/pipeline/office/world';
import { projectOffice } from '../desktop/renderer/pipeline/office/projection';
import { DEMO_IDENTITIES } from '../desktop/renderer/pipeline/office/identities';
import { createDemand, demandNodes, getPipelineFlow, loadPipelineState } from '../desktop/renderer/pipeline/models/templates';
import { cellCenter, seatPixels } from '../desktop/renderer/pipeline/office/vendor/scene/gridProjection';

describe('P6R2 leisure and monitor projection', () => {
  it('puts five idle partners off their seats in five recognizable activities without changing runtime state', () => {
    const identities = Array.from({ length: 5 }, (_, index) => ({ ...DEMO_IDENTITIES[1], id: 'developer-' + index, role: '开发' }));
    const runtime = createStarmapRuntime(identities), world = runtime.readWorld(), leisure = new OfficeLeisure();
    world.actors.forEach((actor, index) => { const pose = leisure.sample(actor.id, index, world, runtime, actor.homeId!, actor.position, 0, true, false)!; expect(pose.stage).toBe('rising'); expect(pose.activity).toBeUndefined(); expect({ x: pose.x, y: pose.y }).toEqual(seatPixels(actor.position)); });
    const poses = world.actors.map((actor, index) => { leisure.sample(actor.id, index, world, runtime, actor.homeId!, actor.position, 15000, true, false); return leisure.sample(actor.id, index, world, runtime, actor.homeId!, actor.position, 19500, true, false)!; });
    expect(poses.map(pose => pose.activity)).toEqual(LEISURE_ACTIVITIES);
    expect(new Set(poses.map(pose => pose.x + ':' + pose.y)).size).toBe(5);
    poses.forEach((pose, index) => expect({ x: pose.x, y: pose.y }).not.toEqual(seatPixels(world.actors[index].position)));
    expect(runtime.readWorld()).toEqual(world); expect(world.props.filter(prop => prop.templateId === 'office.workstation')).toHaveLength(5);
    runtime.dispose();
  });
  it.each([1, 3, 6, 10, 100])('keeps leisure destinations and paths reachable for %i identities', count => {
    const runtime = createStarmapRuntime(Array.from({ length: count }, (_, index) => ({ ...DEMO_IDENTITIES[1], id: 'person-' + index })));
    const world = runtime.readWorld();
    world.actors.forEach((actor, index) => {
      LEISURE_ACTIVITIES.forEach(activity => expect(runtime.navigation.walkable(world, leisureTarget(world, index, activity))).toBe(true));
      const target = leisureTarget(world, index, LEISURE_ACTIVITIES[index % 5]);
      expect(leisureRoute(world, runtime, actor.position, target, actor.homeId).at(-1)).toEqual(cellCenter(target));
    });
    runtime.dispose();
  });
  it('cycles the same partner through all five activities, travelling before using the next prop', () => {
    const runtime = createStarmapRuntime(DEMO_IDENTITIES), world = runtime.readWorld(), actor = world.actors[0], leisure = new OfficeLeisure();
    const sample = (now: number) => leisure.sample(actor.id, 0, world, runtime, actor.homeId!, actor.position, now, true, false)!;
    expect(sample(0).stage).toBe('rising');
    const activities = new Set();
    for (let time = 0; time < 180000; time += 100) { const pose = sample(time); if (pose.activity && pose.activity !== 'brew') activities.add(pose.activity); }
    expect(activities).toEqual(new Set(LEISURE_ACTIVITIES)); runtime.dispose();
  });
  it('returns continuously to the workstation for work and departs continuously when work ends', () => {
    const runtime = createStarmapRuntime(DEMO_IDENTITIES), world = runtime.readWorld(), actor = world.actors[0], leisure = new OfficeLeisure();
    leisure.sample(actor.id, 0, world, runtime, actor.homeId!, actor.position, 0, true, false);
    const idle = leisure.sample(actor.id, 0, world, runtime, actor.homeId!, actor.position, 1000, true, false)!;
    const returning = leisure.sample(actor.id, 0, world, runtime, actor.homeId!, actor.position, 1000, false, false)!;
    expect(returning.returning).toBe(true); expect(returning.x).toBe(idle.x); expect(returning.y).toBe(idle.y);
    expect(leisure.sample(actor.id, 0, world, runtime, actor.homeId!, actor.position, 60000, false, false)).toBeUndefined();
    const departing = leisure.sample(actor.id, 0, world, runtime, actor.homeId!, actor.position, 61000, true, false, true)!;
    expect(departing.stage).toBe('rising'); expect({ x: departing.x, y: departing.y }).toEqual(seatPixels(actor.position));
    runtime.dispose();
  });
  it('freezes leisure under reduced motion and drops departed identities', () => {
    const runtime = createStarmapRuntime(DEMO_IDENTITIES), world = runtime.readWorld(), actor = world.actors[0], leisure = new OfficeLeisure();
    const first = leisure.sample(actor.id, 0, world, runtime, actor.homeId!, actor.position, 0, true, true);
    expect(leisure.sample(actor.id, 0, world, runtime, actor.homeId!, actor.position, 60000, true, true)).toEqual(first);
    leisure.retain([]); expect(leisure.has(actor.id)).toBe(false); runtime.dispose();
  });
  it.each(['pending', 'ready', 'blocked', 'waiting_human', 'failed', 'skipped', 'done', 'running'] as const)('shows the right screen for %s rather than lighting every idle desk', status => {
    const state = loadPipelineState();
    state.demands = [createDemand('屏幕验收', '产品交付组', getPipelineFlow())];
    const demand = state.demands[0];
    demandNodes(getPipelineFlow(demand.workflowId), demand).forEach(node => { demand.nodeStates[node.id] = status; });
    expect(projectOffice(state, DEMO_IDENTITIES).people.every(person => person.screen === (status === 'done' ? 'done' : status === 'running' ? 'working' : 'off'))).toBe(true);
  });
  it('does not show Done for stale partners or partners with unfinished work', () => {
    const state = loadPipelineState(); state.demands = [createDemand('完成验收', '产品交付组', getPipelineFlow())];
    const demand = state.demands[0]; demandNodes(getPipelineFlow(demand.workflowId), demand).forEach(node => { demand.nodeStates[node.id] = 'done'; });
    const identity = { ...DEMO_IDENTITIES[0], assignedUsers: [] };
    expect(projectOffice(state, DEMO_IDENTITIES, [{ identity, status: 'idle', lastSeen: 1, summary: '', expired: true, disconnected: false }]).people[0].screen).toBe('off');
    demand.nodeStates.N01 = 'ready'; expect(projectOffice(state, DEMO_IDENTITIES).people[0].screen).toBe('off');
  });
  it('binds explicit assignees uniquely even when multiple developers share an owner role', () => {
    const state = loadPipelineState(); state.demands = [createDemand('多人开发', '产品交付组', getPipelineFlow())];
    const developers = ['alice', 'bob'].map(name => ({ ...DEMO_IDENTITIES[1], id: name, assignedUsers: [name] }));
    const demand = state.demands[0];
    const developerNode = demandNodes(getPipelineFlow(demand.workflowId), demand).find(node => node.owner === '开发 Agent')!;
    demand.nodeOverrides[developerNode.id] = { assigned_user: 'bob' };
    const projection = projectOffice(state, developers);
    expect(projection.people[1].tasks.some(task => task.nodeId === developerNode.id)).toBe(true);
    expect(projection.people[0].tasks.some(task => task.nodeId === developerNode.id)).toBe(false);
    expect(projection.unbound.some(task => task.owner === '开发 Agent')).toBe(true);
  });
});
