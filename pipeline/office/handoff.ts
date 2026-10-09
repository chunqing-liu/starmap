import { z } from 'zod';
import { officeVisits } from './vendor/runtime/builtin/officePack';
import type { ScenePlugin } from './vendor/runtime/plugins';
import type { OfficeRuntime } from './vendor/runtime/OfficeRuntime';
import type { OfficeInput } from '../../../shared/office';

const params = z.strictObject({ toBeingId: z.string(), summary: z.string().max(160), confirmed: z.boolean(), durationMs: z.number().int().min(300).max(30000) });
export const starmapHandoff: ScenePlugin = {
  id: 'starmap.handoff', name: '真实交接', version: '1.0.0', apiVersion: 1, dependencies: ['office.visits'],
  capabilities: [{ id: 'starmap.handoff', name: '拜访交接', params, build(context, raw) {
    const input = params.parse(raw);
    const plan = officeVisits.capabilities![0].build(context, { stops: [{ hostId: input.toBeingId, message: input.summary, reply: input.confirmed ? '收到 · 接收方已确认' : undefined }], durationMs: input.durationMs });
    const members = context.participants.map(participant => context.world.actors.find(actor => actor.id === participant.entityId)!);
    plan.claims = plan.claims.filter(claim => !claim.resource.startsWith('prop:'));
    plan.claims.push({ resource: 'prop:collab-board:write', units: 1 });
    plan.phases = [
      { title: '起身前往白板', moves: members.map((actor, index) => ({ actorId: actor.id, targetId: 'collab-board', anchor: index ? 'reader2' : 'reader' })), poses: members.map(actor => ({ actorId: actor.id, posture: 'standing' as const })) },
      { title: '白板交接讨论', durationMs: input.durationMs, poses: members.map(actor => ({ actorId: actor.id, facing: 'back' as const })), speech: [{ actorId: members[0].id, text: input.summary }] },
      ...(input.confirmed ? [{ title: '接收方回应', durationMs: Math.max(800, Math.min(input.durationMs, 2000)), speech: [{ actorId: input.toBeingId, text: '收到 · 接收方已确认' }] }] : []),
      { title: '返回工位', moves: members.map(actor => ({ actorId: actor.id, targetId: actor.homeId!, anchor: 'seat' })) },
      { title: '入座', poses: members.map(actor => ({ actorId: actor.id, posture: 'seated' as const, facing: 'back' as const })) },
    ];
    return plan;
  } }],
};
type Handoff = Extract<OfficeInput, { type: 'handoff' }>;
export class HandoffController {
  private waiting = new Map<string, Handoff>();
  private queue: { input: Handoff; confirmed: boolean }[] = [];
  private current?: { input: Handoff; commandId: string; activityId?: string };
  private unsubscribe: () => void;
  private runs = new Map<string, number>();
  private seen = new Set<string>();
  private enabled = false;
  private unavailable = new Set<string>();
  private stopping = false;
  private processing = false;
  readonly feedback: { eventId: string; status: string; code?: string }[] = [];
  constructor(readonly runtime: OfficeRuntime, private onChange = () => {}) {
    this.unsubscribe = runtime.subscribe(() => this.poll());
  }
  receive(input: OfficeInput) {
    if (this.seen.has(input.eventId)) return;
    const previous = this.runs.get(input.beingId) ?? -1;
    if (input.runOrder < previous) return;
    this.seen.add(input.eventId);
    if (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value!);
    if (input.runOrder > previous) {
      this.runs.set(input.beingId, input.runOrder);
      this.queue = this.queue.filter(item => item.input.beingId !== input.beingId);
      for (const [key, request] of this.waiting) if (request.beingId === input.beingId) this.waiting.delete(key);
      if (this.current?.input.beingId === input.beingId) this.cancelCurrent();
    }
    if (input.type === 'handoff') {
      if (!this.enabled || this.unavailable.has(input.beingId) || this.unavailable.has(input.toBeingId)) { this.record(input.eventId, 'suppressed', 'OFFLINE_OR_HIDDEN'); return; }
      if (input.mode === 'business') { this.waiting.set(input.handoffId, input); this.record(input.eventId, 'awaiting_confirmation'); }
      else this.queue.push({ input, confirmed: false });
    }
    if (input.type === 'handoff-confirm') {
      const request = this.waiting.get(input.handoffId);
      if (request && request.toBeingId === input.beingId) { this.waiting.delete(input.handoffId); if (this.enabled) this.queue.push({ input: request, confirmed: true }); }
    }
    if (input.type === 'cancel') {
      this.queue = this.queue.filter(item => item.input.eventId !== input.targetEventId);
      for (const [key, request] of this.waiting) if (request.eventId === input.targetEventId) this.waiting.delete(key);
      if (this.current?.input.eventId === input.targetEventId) this.cancelCurrent();
    }
    this.poll();
  }
  setEnabled(enabled: boolean) { this.enabled = enabled; if (!enabled) { this.queue = []; this.waiting.clear(); this.cancelCurrent(); } else this.poll(); }
  setUnavailable(ids: string[]) {
    this.unavailable = new Set(ids);
    this.queue = this.queue.filter(item => !this.unavailable.has(item.input.beingId) && !this.unavailable.has(item.input.toBeingId));
    for (const [key, request] of this.waiting) if (this.unavailable.has(request.beingId) || this.unavailable.has(request.toBeingId)) this.waiting.delete(key);
    if (this.current && (this.unavailable.has(this.current.input.beingId) || this.unavailable.has(this.current.input.toBeingId))) this.cancelCurrent();
  }
  stopForRoster() { this.stopping = true; this.queue = []; this.waiting.clear(); this.cancelCurrent(); }
  get settled() { return !this.current && !this.runtime.snapshot().resources.some(resource => resource.holders.length); }
  private cancelCurrent() {
    const current = this.current;
    if (!current) return;
    const record = this.runtime.snapshot().records.find(record => record.command.commandId === current.commandId);
    if (!record || ['completed', 'failed', 'cancelled', 'rejected', 'expired'].includes(record.status)) return;
    this.runtime.submit({ protocolVersion: '2.0', sceneId: this.runtime.sceneId, commandId: 'stop-' + crypto.randomUUID(), ...(record.status === 'queued' ? { type: 'command.cancel', targetCommandId: current.commandId } : { type: 'activity.stop', activityId: record.activityId || current.activityId! }) });
  }
  private poll() {
    if (this.processing) return;
    this.processing = true;
    try {
      if (this.current) {
        const snapshot = this.runtime.snapshot();
        const record = snapshot.records.find(record => record.command.commandId === this.current!.commandId);
        if (record?.activityId) this.current.activityId = record.activityId;
        if (record && ['completed', 'failed', 'cancelled', 'rejected', 'expired'].includes(record.status) && !snapshot.resources.some(resource => resource.holders.includes(this.current!.activityId || ''))) {
          this.record(this.current.input.eventId, record.status, record.error?.code);
          this.current = undefined;
        }
      }
      if (!this.current && this.enabled && !this.stopping && this.queue.length) {
        const item = this.queue.shift()!;
        const commandId = 'handoff-' + crypto.randomUUID();
        this.current = { input: item.input, commandId };
        const result = this.runtime.submit({ protocolVersion: '2.0', sceneId: this.runtime.sceneId, commandId, type: 'activity.start', capability: 'starmap.handoff', busyPolicy: 'reject', participants: [{ entityId: item.input.beingId, role: 'visitor' }, { entityId: item.input.toBeingId, role: 'host' }], params: { toBeingId: item.input.toBeingId, summary: item.input.summary, confirmed: item.confirmed, durationMs: item.input.durationMs } });
        this.current.activityId = result.activityId;
        if (result.status === 'rejected' || result.status === 'failed') { this.record(item.input.eventId, result.status, result.error?.code); if (!this.runtime.snapshot().resources.some(resource => resource.holders.includes(result.activityId || ''))) this.current = undefined; }
      }
    } finally { this.processing = false; }
    this.onChange();
  }
  private record(eventId: string, status: string, code?: string) { const previous = this.feedback.findIndex(item => item.eventId === eventId); if (previous >= 0) this.feedback[previous] = { eventId, status, code }; else this.feedback.push({ eventId, status, code }); if (this.feedback.length > 50) this.feedback.shift(); this.onChange(); }
  dispose() { this.setEnabled(false); this.unsubscribe(); }
}
