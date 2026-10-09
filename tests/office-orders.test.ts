import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { OfficeOrders } from '../desktop/main/office/orders';

it('main allocates monotonic orders, survives restart and rejects retired runs', () => {
  const folder = mkdtempSync(join(tmpdir(), 'office-orders-'));
  try {
    const file = join(folder, 'orders.json');
    const raw = { type: 'disconnect', beingId: 'a', eventId: 'one', runId: 'run-1' };
    const first = new OfficeOrders(file).assign(raw);
    expect(first.runOrder).toBe(1); expect(first.eventOrder).toBe(1);
    const restored = new OfficeOrders(file);
    expect(restored.assign(raw)).toEqual(first);
    expect(restored.assign({ ...raw, eventId: 'two', eventOrder: 1000, runOrder: 9000 }).eventOrder).toBe(2);
    expect(restored.assign({ ...raw, eventId: 'three', runId: 'run-2' }).runOrder).toBe(2);
    expect(() => new OfficeOrders(file).assign({ ...raw, eventId: 'late' })).toThrow('STALE_RUN');
    expect(() => restored.assign({ ...raw, eventId: 'three', runId: 'run-2', type: 'unregister' })).toThrow('EVENT_CONFLICT');
    expect(() => restored.assign(raw)).toThrow('STALE_RUN');
    writeFileSync(file, '{broken'); expect(() => new OfficeOrders(file)).toThrow();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
