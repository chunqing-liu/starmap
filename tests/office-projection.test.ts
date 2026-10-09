import { describe, expect, it, vi } from 'vitest';
import { projectOffice, STATUS_MARKERS } from '../desktop/renderer/pipeline/office/projection';
import { DEMO_IDENTITIES, IdentityRegistry } from '../desktop/renderer/pipeline/office/identities';
import { createStarmapRuntime, createStarmapWorld } from '../desktop/renderer/pipeline/office/world';
import { OfficeBridge } from '../desktop/renderer/pipeline/office/bridge';
import { createDemand, loadPipelineState, getPipelineFlow, demandNodes } from '../desktop/renderer/pipeline/models/templates';
import { NODE_STATUSES } from '../desktop/renderer/pipeline/models/schema';
import { PIXEL_FRAME_COUNTS } from '../desktop/renderer/pipeline/office/pixel-art';

function fixture() {
  const state = loadPipelineState();
  state.demands = [createDemand('甲', '产品交付组', getPipelineFlow()), createDemand('乙', '产品交付组', getPipelineFlow())];
  return state;
}

describe('office projection', () => {
  it('generates seated, walking, typing and thinking frame families offline', () => {
    expect(PIXEL_FRAME_COUNTS).toEqual({ idle: 1, seated: 1, walking: 4, working: 4, thinking: 4 });
  });
  it('maps every status without pretending ready or blocked are activity', () => {
    for (const status of NODE_STATUSES) {
      const state = fixture();
      state.demands = state.demands.slice(0, 1);
      const demand = state.demands[0];
      for (const node of demandNodes(getPipelineFlow(demand.workflowId), demand)) demand.nodeStates[node.id] = status;
      const people = projectOffice(state, DEMO_IDENTITIES).people;
      expect(people.every(person => person.status === (status === 'running' ? 'working' : 'idle'))).toBe(true);
      expect(people.every(person => person.marker === STATUS_MARKERS[status])).toBe(true);
    }
  });
  it('aggregates every track with scoped node keys and one actor per identity', () => {
    const state = fixture();
    const result = projectOffice(state, DEMO_IDENTITIES);
    expect(result.people).toHaveLength(3);
    const tasks = result.people.flatMap(person => person.tasks);
    expect(new Set(tasks.map(task => task.key)).size).toBe(tasks.length);
    expect(tasks.some(task => task.demandId === state.demands[1].id)).toBe(true);
  });
  it('keeps empty, duplicate and human owners unbound and filters reviewer assignment', () => {
    const state = fixture();
    const demand = state.demands[0];
    demand.nodeOverrides.N01 = { owner: '' };
    demand.nodeStates.H1 = 'waiting_human';
    demand.nodeOverrides.H1 = { assigned_user: state.board.currentUserId };
    const result = projectOffice(state, [...DEMO_IDENTITIES, { ...DEMO_IDENTITIES[0], id: 'duplicate' }]);
    expect(result.unbound.some(task => task.nodeId === 'N01')).toBe(true);
    expect(result.unbound.some(task => task.nodeId === 'N02')).toBe(true);
    expect(result.reviews).toHaveLength(1);
  });
  it('gives waiting and failure precedence without losing concurrent running tasks', () => {
    const state = fixture();
    state.demands[0].nodeStates.N01 = 'running';
    state.demands[1].nodeStates.H1 = 'waiting_human';
    const product = projectOffice(state, DEMO_IDENTITIES).people[0];
    expect(product.status).toBe('idle');
    expect(product.tasks.some(task => task.status === 'running')).toBe(true);
    expect(product.marker).toBe('待审核');
  });
  it('supports dynamic identity registration without changing upstream six-person world', () => {
    const registry = new IdentityRegistry([]);
    registry.register(DEMO_IDENTITIES[0]);
    expect(createStarmapWorld(registry.list()).actors).toHaveLength(1);
    registry.unregister(DEMO_IDENTITIES[0].id);
    expect(createStarmapWorld(registry.list()).actors).toHaveLength(0);
  });
  it('coalesces at 100ms, deduplicates presentations and uses monotonic source revisions', () => {
    vi.useFakeTimers();
    const runtime = createStarmapRuntime(DEMO_IDENTITIES);
    const bridge = new OfficeBridge(runtime);
    const submit = vi.spyOn(runtime, 'submit');
    bridge.project([{ id: DEMO_IDENTITIES[0].id, status: 'working', title: '工作' }]);
    bridge.project([{ id: DEMO_IDENTITIES[0].id, status: 'idle', title: '待审核' }]);
    vi.advanceTimersByTime(99);
    expect(submit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(runtime.readActors()[0].presentation.status).toBe('idle');
    expect(submit).toHaveBeenCalledTimes(1);
    bridge.project([{ id: DEMO_IDENTITIES[0].id, status: 'idle', title: '待审核' }]);
    vi.advanceTimersByTime(100);
    expect(submit).toHaveBeenCalledTimes(1);
    bridge.project([{ id: DEMO_IDENTITIES[0].id, status: 'working', title: '工作' }]);
    vi.advanceTimersByTime(100);
    expect(runtime.readActors()[0].presentation.sourceRevision).toBe(2);
    bridge.markStale();
    expect(bridge.stale).toBe(true);
    bridge.dispose(); runtime.dispose(); vi.useRealTimers();
  });
});
