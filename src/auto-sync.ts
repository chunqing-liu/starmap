import { TeamSync } from './sync';

export interface SyncEnvironment {
  visible(): boolean;
  online(): boolean;
  now(): number;
  later(callback: () => void, delay: number): unknown;
  cancel(timer: unknown): void;
  listen(callback: () => void): () => void;
}
export const browserSyncEnvironment = (): SyncEnvironment => ({
  visible: () => document.visibilityState !== 'hidden', online: () => navigator.onLine !== false, now: () => Date.now(),
  later: (callback, delay) => window.setTimeout(callback, delay), cancel: timer => window.clearTimeout(timer as number),
  listen(callback) {
    document.addEventListener('visibilitychange', callback); window.addEventListener('online', callback); window.addEventListener('offline', callback); window.addEventListener('focus', callback);
    return () => { document.removeEventListener('visibilitychange', callback); window.removeEventListener('online', callback); window.removeEventListener('offline', callback); window.removeEventListener('focus', callback); };
  },
});
export class AutoSync {
  private timer: unknown;
  private stopped = true;
  private running = false;
  private requested = false;
  private failures = 0;
  private retryAt = 0;
  private editedAt = -Infinity;
  private draft: unknown;
  private unsubscribe = () => {};
  private unlisten = () => {};
  constructor(private sync: TeamSync, private actor: string, private environment: SyncEnvironment, readonly interval = 5000, readonly debounce = 800) {
    if (!Number.isFinite(interval) || interval < 3000 || interval > 60000) throw new Error('自动检查间隔须为 3–60 秒。');
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false; this.draft = this.sync.snapshot().draft;
    this.unsubscribe = this.sync.subscribe(() => {
      const snapshot = this.sync.snapshot();
      if (snapshot.draft !== this.draft) { this.draft = snapshot.draft; this.editedAt = this.environment.now(); if (!this.running) this.schedule(this.debounce); }
    });
    this.unlisten = this.environment.listen(() => this.wake());
    this.wake();
  }
  stop() {
    this.stopped = true; this.requested = false; this.environment.cancel(this.timer); this.unsubscribe(); this.unlisten();
  }
  private ready() { return !this.stopped && this.environment.visible() && this.environment.online(); }
  private schedule(delay: number) {
    this.environment.cancel(this.timer);
    const code = this.sync.snapshot().errorCode;
    if (code && !['network', 'http', 'unknown', 'conflict'].includes(code)) return;
    if (this.ready()) this.timer = this.environment.later(() => { void this.tick(); }, Math.max(delay, this.retryAt - this.environment.now()));
  }
  wake() {
    this.environment.cancel(this.timer);
    if (!this.stopped && !this.environment.online()) this.sync.offline();
    if (!this.ready()) return;
    this.retryAt = 0;
    if (this.running) { this.requested = true; return; }
    this.schedule(0);
  }
  async tick() {
    if (!this.ready() || this.running) return;
    if (this.sync.snapshot().busy) { this.schedule(this.interval); return; }
    this.running = true; this.requested = false;
    try {
      let snapshot = this.sync.snapshot();
      if (snapshot.storageFailed) return;
      if (snapshot.status !== 'conflict') await this.sync.check();
      if (!this.ready()) return;
      snapshot = this.sync.snapshot();
      if (snapshot.storageFailed) return;
      const pause = snapshot.status === 'conflict' || snapshot.status === 'unknown' || snapshot.storageFailed || Boolean(snapshot.errorCode);
      const remaining = this.debounce - (this.environment.now() - this.editedAt);
      if (!pause && snapshot.base?.state && snapshot.dirty && remaining <= 0) await this.sync.push(this.actor);
      snapshot = this.sync.snapshot();
      if (snapshot.errorCode) this.failures++; else this.failures = 0;
      if (snapshot.errorCode && !['network', 'http', 'unknown', 'conflict'].includes(snapshot.errorCode)) return;
      const delay = this.failures ? Math.min(60000, this.interval * 2 ** Math.min(5, this.failures)) : snapshot.dirty && snapshot.base?.state && snapshot.status !== 'conflict' ? Math.max(50, remaining) : this.interval;
      this.retryAt = this.failures && !this.requested ? this.environment.now() + delay : 0;
      this.schedule(this.requested ? 0 : delay);
    } finally { this.running = false; }
  }
}
