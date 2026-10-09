import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfficePresenceClient } from '../desktop/renderer/pipeline/office/presence';
import type { OfficeMessage, OfficeSnapshot } from '../desktop/shared/office';
const snapshot = (sequence: number): OfficeSnapshot => ({ sequence, entries: [], reports: [] });
afterEach(() => vi.unstubAllGlobals());
describe('presence reconnect protocol', () => {
  it('subscribes before snapshot, applies only newer deltas and never replays snapshot activities', async () => {
    let listener!: (message: OfficeMessage) => void, resolve!: (snapshot: OfficeSnapshot) => void;
    const unsubscribe = vi.fn(), received: string[] = [];
    vi.stubGlobal('window', { beings: { onOfficeMessage: (callback: typeof listener) => { listener = callback; return unsubscribe; }, officeSnapshot: () => new Promise<OfficeSnapshot>(callback => { resolve = callback; }) } });
    const client = new OfficePresenceClient(state => received.push('snapshot:' + state.sequence), input => received.push('input:' + input.eventId), error => received.push(error));
    const connecting = client.connect();
    const input = { type: 'disconnect', eventId: 'latest', beingId: 'alpha', runId: 'run', runOrder: 1, eventOrder: 2 } as const;
    listener({ kind: 'delta', sequence: 1, snapshot: snapshot(1), input: { ...input, eventId: 'historical' } });
    listener({ kind: 'delta', sequence: 3, snapshot: snapshot(3), input });
    resolve(snapshot(2)); await connecting;
    expect(received).toEqual(['snapshot:2', 'snapshot:3', 'input:latest']);
    listener({ kind: 'delta', sequence: 3, snapshot: snapshot(3), input });
    expect(received).toHaveLength(3);
    client.dispose(); expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it('resynchronizes a sequence gap via snapshot instead of replaying missing activity', async () => {
    let listener!: (message: OfficeMessage) => void;
    const received: number[] = [], input = vi.fn();
    const fetch = vi.fn().mockResolvedValueOnce(snapshot(1)).mockResolvedValueOnce(snapshot(4));
    vi.stubGlobal('window', { beings: { onOfficeMessage: (callback: typeof listener) => { listener = callback; return () => {}; }, officeSnapshot: fetch } });
    const client = new OfficePresenceClient(state => received.push(state.sequence), input, () => {});
    await client.connect();
    listener({ kind: 'delta', sequence: 4, snapshot: snapshot(4), input: { type: 'disconnect', eventId: 'gap', beingId: 'alpha', runId: 'run', runOrder: 1, eventOrder: 4 } });
    await Promise.resolve();
    expect(received).toEqual([1, 4]); expect(input).not.toHaveBeenCalled();
    client.dispose();
  });
});

