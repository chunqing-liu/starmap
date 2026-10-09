import { describe, expect, it } from 'vitest';
import { createStarmapRuntime } from '../desktop/renderer/pipeline/office/world';
import { DEMO_IDENTITIES } from '../desktop/renderer/pipeline/office/identities';

const visit = (commandId: string) => ({ protocolVersion: '2.0', sceneId: 'starmap-office', commandId, type: 'activity.start', capability: 'office.visit', participants: [{ entityId: 'demo-product', role: 'visitor' }, { entityId: 'demo-development', role: 'host' }], params: { stops: [{ hostId: 'demo-development', message: '验证动作链' }], durationMs: 300 } });

describe('vendored office runtime in host world', () => {
  it('reserves resources and performs rise, walk, align and return to seat', () => {
    const runtime = createStarmapRuntime(DEMO_IDENTITIES);
    const initial = runtime.readActors()[0].position;
    expect(runtime.submit(visit('visit')).status).toBe('running');
    const stages = new Set<string>();
    for (let elapsed = 0; elapsed < 30000; elapsed += 50) {
      runtime.tick(50);
      const actor = runtime.readActors()[0];
      if (actor.seatTransition) stages.add(actor.seatTransition.stage);
      if (actor.step || actor.motion) stages.add('walking');
    }
    expect(stages.has('rising')).toBe(true);
    expect(stages.has('walking')).toBe(true);
    expect(stages.has('aligning')).toBe(true);
    expect(stages.has('sitting')).toBe(true);
    expect(runtime.readActors()[0].position).toEqual(initial);
    expect(runtime.readActors()[0].posture).toBe('seated');
    expect(runtime.snapshot().resources.every(resource => !resource.holders.length)).toBe(true);
    runtime.dispose();
  });
  it('cancels a queued command separately from a continuous activity', () => {
    const runtime = createStarmapRuntime(DEMO_IDENTITIES);
    runtime.submit({ protocolVersion: '2.0', sceneId: runtime.sceneId, commandId: 'continuous', type: 'activity.start', capability: 'office.focus', participants: [{ entityId: 'demo-product', role: 'worker' }], params: { title: '长期占用测试' } });
    expect(runtime.submit({ ...visit('queued'), busyPolicy: 'queue' }).status).toBe('queued');
    runtime.submit({ protocolVersion: '2.0', sceneId: runtime.sceneId, commandId: 'cancel-queued', type: 'command.cancel', targetCommandId: 'queued' });
    expect(runtime.snapshot().records.find(record => record.command.commandId === 'queued')?.status).toBe('cancelled');
    runtime.submit({ protocolVersion: '2.0', sceneId: runtime.sceneId, commandId: 'stop-active', type: 'activity.stop', activityId: 'continuous' });
    for (let elapsed = 0; elapsed < 30000; elapsed += 50) runtime.tick(50);
    expect(runtime.snapshot().resources.every(resource => !resource.holders.length)).toBe(true);
    runtime.dispose();
  });
  it('does not replay duplicate commands and releases claims after cancellation', () => {
    const runtime = createStarmapRuntime(DEMO_IDENTITIES);
    runtime.submit(visit('same'));
    runtime.submit(visit('same'));
    expect(runtime.snapshot().activities).toHaveLength(1);
    expect(runtime.submit({ ...visit('busy'), busyPolicy: 'reject' }).error?.code).toBe('BUSY');
    runtime.submit({ protocolVersion: '2.0', sceneId: runtime.sceneId, commandId: 'cancel', type: 'command.cancel', targetCommandId: 'same' });
    for (let elapsed = 0; elapsed < 30000; elapsed += 50) runtime.tick(50);
    expect(runtime.snapshot().resources.every(resource => !resource.holders.length)).toBe(true);
    runtime.dispose();
  });
});
