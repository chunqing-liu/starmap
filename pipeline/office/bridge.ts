import type { OfficeRuntime } from './vendor/runtime/OfficeRuntime';
import type { NodeStateSource } from './identities';
import type { OfficeScreen } from './leisure';

export interface ActorPresentation {
  id: string;
  status: 'idle' | 'working' | 'thinking';
  title: string;
  screen?: OfficeScreen;
}

export class OfficeBridge {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private latest: ActorPresentation[] = [];
  private applied = new Map<string, string>();
  private revision = 0;
  private disposed = false;
  stale = false;
  lastSource: NodeStateSource = { kind: 'local' };
  constructor(readonly runtime: OfficeRuntime) {}
  project(actors: ActorPresentation[], source: NodeStateSource = { kind: 'local' }) {
    if (this.disposed) return;
    this.latest = actors;
    this.lastSource = source;
    this.stale = false;
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 100);
  }
  private flush() {
    this.timer = undefined;
    for (const actor of this.latest) {
      const signature = JSON.stringify([actor.status, actor.title]);
      if (this.applied.get(actor.id) === signature) continue;
      const result = this.runtime.submit({ protocolVersion: '2.0', sceneId: this.runtime.sceneId, commandId: 'projection-' + crypto.randomUUID(), type: 'actor.presentation.set', actorId: actor.id, status: actor.status, title: actor.title.slice(0, 200), sourceRevision: ++this.revision });
      if (result.status === 'rejected') throw new Error(result.error?.message || '状态投影失败');
      this.applied.set(actor.id, signature);
    }
  }
  markStale() { this.stale = true; }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.latest = []; }
}
