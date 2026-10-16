export function createHostDataWriter(write: (patch: Record<string, string | null>) => Promise<void>, later: (callback: () => void) => void = callback => { setTimeout(callback, 200); }) {
  let scheduled = false, active = false;
  const batches: { patch: Record<string, string | null>; separate: boolean; waiters: { resolve(): void; reject(error: unknown): void }[] }[] = [];
  const schedule = () => {
    if (scheduled || active || !batches.length) return;
    scheduled = true; later(() => { void flush(); });
  };
  const flush = async () => {
    scheduled = false; active = true;
    const batch = batches.shift()!;
    try { await write(batch.patch); batch.waiters.forEach(waiter => waiter.resolve()); }
    catch (error) { batch.waiters.forEach(waiter => waiter.reject(error)); }
    finally { active = false; schedule(); }
  };
  return (patch: Record<string, string | null>, separate = false) => new Promise<void>((resolve, reject) => {
    let batch = batches.at(-1);
    if (!batch || separate || batch.separate) { batch = { patch: {}, separate, waiters: [] }; batches.push(batch); }
    Object.assign(batch.patch, patch); batch.waiters.push({ resolve, reject }); schedule();
  });
}
