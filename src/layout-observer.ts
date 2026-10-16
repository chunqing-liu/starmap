export function frameResizeObserver(NativeObserver: typeof ResizeObserver, frames: { request(callback: FrameRequestCallback): number; cancel(handle: number): void }) {
  return class extends NativeObserver {
    private targets = new Set<Element>();
    private entries = new Map<Element, ResizeObserverEntry>();
    private scheduled: number | undefined;
    constructor(callback: ResizeObserverCallback) {
      super(entries => {
        for (const entry of entries) if (this.targets.has(entry.target)) this.entries.set(entry.target, entry);
        if (this.scheduled !== undefined || !this.entries.size) return;
        this.scheduled = frames.request(() => {
          this.scheduled = undefined;
          const pending = [...this.entries.values()]; this.entries.clear();
          if (pending.length) callback(pending, this);
        });
      });
    }
    observe(target: Element, options?: ResizeObserverOptions) { this.targets.add(target); super.observe(target, options); }
    unobserve(target: Element) { this.targets.delete(target); this.entries.delete(target); super.unobserve(target); }
    disconnect() {
      super.disconnect(); this.targets.clear(); this.entries.clear();
      if (this.scheduled !== undefined) frames.cancel(this.scheduled);
      this.scheduled = undefined;
    }
  };
}
