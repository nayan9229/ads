export interface AnalyticsEmitterOptions {
  readonly endpoint?: string;
  readonly sampleRate?: number;
  readonly sessionId: string;
  readonly rng?: () => number;
  readonly getNow?: () => number;
  readonly bufferCap?: number;
}

const DEFAULT_BUFFER_CAP = 50;

export class AnalyticsEmitter {
  private readonly endpoint: string | undefined;
  private readonly sampleRate: number;
  private readonly sessionId: string;
  private readonly rng: () => number;
  private readonly getNow: () => number;
  private readonly bufferCap: number;
  private buffer: string[] = [];
  private pageHideHandler: (() => void) | null = null;
  private bufferOverflowed = false;

  constructor(opts: AnalyticsEmitterOptions) {
    this.endpoint = opts.endpoint;
    this.sampleRate = opts.sampleRate ?? 1.0;
    this.sessionId = opts.sessionId;
    this.rng = opts.rng ?? Math.random;
    this.getNow = opts.getNow ?? Date.now;
    this.bufferCap = opts.bufferCap ?? DEFAULT_BUFFER_CAP;
  }

  emit(type: string, payload: Record<string, unknown> = {}): void {
    if (!this.endpoint) return;
    if (this.sampleRate <= 0) return;
    if (this.sampleRate < 1 && this.rng() >= this.sampleRate) return;

    const body = JSON.stringify({
      v: 1,
      type,
      ts: this.getNow(),
      sessionId: this.sessionId,
      ...payload,
    });

    const ok = this.beacon(body);
    if (!ok) this.bufferEvent(body);
  }

  attachPageHideFlush(target: Window | typeof globalThis = window): void {
    if (this.pageHideHandler) return;
    this.pageHideHandler = () => this.flush();
    (target as Window).addEventListener("pagehide", this.pageHideHandler);
  }

  dispose(): void {
    this.flush();
    if (this.pageHideHandler) {
      window.removeEventListener("pagehide", this.pageHideHandler);
      this.pageHideHandler = null;
    }
  }

  flush(): void {
    if (!this.endpoint || this.buffer.length === 0) return;
    const pending = this.buffer;
    this.buffer = [];
    for (const body of pending) {
      const ok = this.beacon(body);
      if (!ok) this.buffer.push(body);
    }
  }

  private beacon(body: string): boolean {
    if (!this.endpoint) return false;
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") {
      return false;
    }
    return navigator.sendBeacon(this.endpoint, body);
  }

  private bufferEvent(body: string): void {
    if (this.buffer.length >= this.bufferCap) {
      if (!this.bufferOverflowed) {
        this.bufferOverflowed = true;
        const overflowBody = JSON.stringify({
          v: 1,
          type: "buffer_overflow",
          ts: this.getNow(),
          sessionId: this.sessionId,
          cap: this.bufferCap,
        });
        // Replace oldest with overflow marker.
        this.buffer.shift();
        this.buffer.push(overflowBody);
      }
      return;
    }
    this.buffer.push(body);
  }
}
