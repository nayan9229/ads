export interface RefreshSchedulerOptions {
  readonly intervalMs: number;
  readonly isInView: () => boolean;
  readonly onRefresh: () => void;
  readonly onCapReached?: () => void;
  readonly sessionCap?: number;
  readonly viewportNotifier?: (cb: () => void) => () => void;
}

export class RefreshScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;
  private fires = 0;
  private remainingMs: number | null = null;
  private timerStartedAt = 0;
  private visibilityHandler: (() => void) | null = null;
  private viewportUnsub: (() => void) | null = null;

  constructor(private readonly opts: RefreshSchedulerOptions) {}

  start(): void {
    if (this.cancelled) return;
    if (this.opts.sessionCap !== undefined && this.fires >= this.opts.sessionCap) return;
    this.attachVisibilityListener();
    this.attachViewportNotifier();
    this.remainingMs = this.opts.intervalMs;
    this.scheduleNext();
  }

  cancel(): void {
    this.cancelled = true;
    this.clearTimer();
    this.detachVisibilityListener();
    this.detachViewportNotifier();
  }

  private scheduleNext(): void {
    if (this.cancelled) return;
    if (!this.isPlayable()) return;
    const delay = this.remainingMs ?? this.opts.intervalMs;
    this.timerStartedAt = Date.now();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.cancelled) return;
      this.opts.onRefresh();
      this.fires += 1;
      this.remainingMs = this.opts.intervalMs;
      if (this.opts.sessionCap !== undefined && this.fires >= this.opts.sessionCap) {
        this.opts.onCapReached?.();
        this.cancel();
        return;
      }
      this.scheduleNext();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      const elapsed = Date.now() - this.timerStartedAt;
      const remaining = (this.remainingMs ?? this.opts.intervalMs) - elapsed;
      this.remainingMs = Math.max(0, remaining);
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private isPlayable(): boolean {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
    if (!this.opts.isInView()) return false;
    return true;
  }

  private attachVisibilityListener(): void {
    if (typeof document === "undefined") return;
    this.visibilityHandler = () => {
      if (this.cancelled) return;
      if (document.visibilityState === "hidden") {
        this.clearTimer();
      } else {
        this.scheduleNext();
      }
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  private detachVisibilityListener(): void {
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  private attachViewportNotifier(): void {
    if (!this.opts.viewportNotifier) return;
    this.viewportUnsub = this.opts.viewportNotifier(() => {
      if (this.cancelled) return;
      if (this.opts.isInView()) this.scheduleNext();
      else this.clearTimer();
    });
  }

  private detachViewportNotifier(): void {
    if (this.viewportUnsub) {
      this.viewportUnsub();
      this.viewportUnsub = null;
    }
  }
}
