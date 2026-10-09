import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OfficeOrders } from '../desktop/main/office/orders';

it('expires inactive ledger identities without resetting the monotonic counter', () => {
  const folder = mkdtempSync(join(tmpdir(), 'office-orders-capacity-'));
  try {
    const file = join(folder, 'orders.json'); let time = 1;
    const orders = new OfficeOrders(file, () => time);
    const input = { type: 'disconnect', beingId: 'a', runId: 'one', eventId: 'first' };
    expect(orders.assign(input).runOrder).toBe(1);
    time += 31 * 24 * 60 * 60 * 1000;
    expect(orders.assign({ ...input, beingId: 'b', eventId: 'second' }).runOrder).toBe(2);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.runs.map((run: { beingId: string }) => run.beingId)).toEqual(['b']);
    expect(saved.events).toHaveLength(1);
    const full = { nextRunOrder: 1024, events: [], runs: Array.from({ length: 1024 }, (_, index) => ({ beingId: 'b-' + index, runId: 'one', runOrder: index + 1, eventOrder: 1, retired: [], lastSeen: time })) };
    writeFileSync(file, JSON.stringify(full));
    const bounded = new OfficeOrders(file, () => time);
    expect(() => bounded.assign({ ...input, beingId: 'extra', eventId: 'overflow' })).toThrow('ORDER_CAPACITY');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(full);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
