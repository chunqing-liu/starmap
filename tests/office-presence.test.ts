import { describe, expect, it } from 'vitest';
import { OfficePresenceRegistry } from '../desktop/main/office/registry';
import { OFFICE_SEEDS, type OfficeInput } from '../desktop/shared/office';
const identity = (id: string) => ({ ...OFFICE_SEEDS[0], id, name: id, demo: false, owners: [id] });
const order = (beingId: string, eventOrder = 1, runOrder = 1) => ({ beingId, eventId: beingId + '-' + runOrder + '-' + eventOrder, eventOrder, runOrder, runId: 'run-' + runOrder });
const register = (beingId: string) => ({ ...order(beingId), type: 'register', identity: identity(beingId) });

describe('main presence registry', () => {
  it('isolates two beings and rejects duplicates, conflicts and old runs', () => {
    const registry = new OfficePresenceRegistry(() => 1000);
    expect(registry.accept(register('alpha')).accepted).toBe(true);
    registry.accept(register('beta'));
    const input = { ...order('alpha', 2), type: 'presence', status: 'working', lastSeen: 1000 };
    registry.accept(input);
    registry.accept({ ...order('beta', 2), type: 'presence', status: 'thinking', lastSeen: 1000 });
    expect(registry.snapshot().entries.slice(-2).map(entry => entry.status)).toEqual(['working', 'thinking']);
    const sequence = registry.snapshot().sequence;
    expect(registry.accept(input).duplicate).toBe(true);
    expect(registry.snapshot().sequence).toBe(sequence);
    expect(registry.accept({ ...input, status: 'idle' }).code).toBe('EVENT_CONFLICT');
    registry.accept({ ...order('alpha', 1, 2), type: 'presence', status: 'idle', lastSeen: 1000 });
    expect(registry.accept({ ...order('alpha', 3), type: 'presence', status: 'working', lastSeen: 1000 }).code).toBe('STALE_RUN');
    expect(registry.snapshot().entries.find(entry => entry.identity.id === 'alpha')?.status).toBe('idle');
  });
  it('retains last snapshot on disconnect/expiry and rejects impersonated confirmation', () => {
    let now = 1000;
    const registry = new OfficePresenceRegistry(() => now, 30000);
    registry.accept(register('alpha')); registry.accept(register('beta'));
    registry.accept({ ...order('alpha', 2), type: 'presence', status: 'thinking', lastSeen: now });
    registry.accept({ ...order('alpha', 3), type: 'disconnect' });
    expect(registry.snapshot().entries.find(entry => entry.identity.id === 'alpha')).toMatchObject({ status: 'thinking', lastSeen: 1000, expired: true, disconnected: true });
    registry.accept({ ...order('alpha', 4), type: 'presence', status: 'working', lastSeen: now });
    now = 32000; registry.expire();
    expect(registry.snapshot().entries.find(entry => entry.identity.id === 'alpha')?.expired).toBe(true);
    registry.accept({ ...order('alpha', 5), type: 'handoff', handoffId: 'business', toBeingId: 'beta', mode: 'business' });
    expect(registry.accept({ ...order('alpha', 6), type: 'handoff-confirm', handoffId: 'business' }).code).toBe('INVALID_CONFIRMATION');
    expect(registry.accept({ ...order('beta', 2), type: 'handoff-confirm', handoffId: 'business' }).accepted).toBe(true);
    expect(registry.accept({ ...order('beta', 3), type: 'cancel', targetEventId: 'alpha-1-5' }).code).toBe('NOT_OWNER');
  });
  it('keeps run tombstones after unregister and snapshots contain no activity replay', () => {
    const registry = new OfficePresenceRegistry(() => 1000);
    registry.accept(register('alpha'));
    registry.accept({ ...order('alpha', 2), type: 'unregister' });
    expect(registry.accept({ ...register('alpha'), eventId: 'old-registration' }).code).toBe('STALE_RUN');
    expect(registry.snapshot().entries.some(entry => entry.identity.id === 'alpha')).toBe(false);
    expect(Object.keys(registry.snapshot())).toEqual(['sequence', 'entries', 'reports']);
  });
});
