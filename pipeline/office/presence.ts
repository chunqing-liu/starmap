import type { OfficeInput, OfficeMessage, OfficeSnapshot } from '../../../shared/office';

export class OfficePresenceClient {
  private unsubscribe?: () => void;
  private disposed = false;
  private ready = false;
  private sequence = -1;
  private buffered: OfficeMessage[] = [];
  constructor(private onSnapshot: (snapshot: OfficeSnapshot) => void, private onInput: (input: OfficeInput) => void, private onError: (error: string) => void) {}
  async connect() {
    this.ready = false;
    this.unsubscribe?.();
    this.unsubscribe = window.beings.onOfficeMessage(message => {
      if (this.disposed) return;
      if (!this.ready) { this.buffered.push(message); return; }
      this.receive(message);
    });
    try {
      const snapshot = await window.beings.officeSnapshot();
      if (this.disposed) return;
      this.sequence = snapshot.sequence;
      this.onSnapshot(snapshot);
      this.ready = true;
      const buffered = this.buffered.splice(0);
      buffered.forEach(message => { if (this.ready) this.receive(message); else this.buffered.push(message); });
    } catch (error) { if (!this.disposed) this.onError(String(error)); }
  }
  private receive(message: OfficeMessage) {
    if (message.kind === 'snapshot') { this.sequence = message.snapshot.sequence; this.onSnapshot(message.snapshot); return; }
    if (message.sequence <= this.sequence) return;
    if (message.sequence !== this.sequence + 1) { void this.connect(); return; }
    this.sequence = message.sequence;
    this.onSnapshot(message.snapshot);
    if (message.input) this.onInput(message.input);
  }
  dispose() { this.disposed = true; this.unsubscribe?.(); this.buffered = []; }
}
