export type Attempt = () => boolean | Promise<boolean>;

export interface RetrySchedulerOptions {
  readonly delaysMs: ReadonlyArray<number>;
  readonly attempt: Attempt;
  readonly isInView: () => boolean;
  readonly onExhausted?: () => void;
  readonly viewportNotifier?: (cb: () => void) => () => void;
}

export class RetryScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attemptIndex = 0;
  private cancelled = false;
  private finished = false;
  private waitingForViewport = false;
  private viewportUnsub: (() => void) | null = null;

  constructor(private readonly opts: RetrySchedulerOptions) {}

  start(): void {
    if (this.cancelled || this.finished) return;
    this.scheduleNext();
  }

  cancel(): void {
    if (this.finished) return;
    this.cancelled = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.unsubscribeViewport();
  }

  private scheduleNext(): void {
    if (this.cancelled || this.finished) return;
    const delay = this.opts.delaysMs[this.attemptIndex];
    if (delay === undefined) {
      this.finished = true;
      this.opts.onExhausted?.();
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runAttempt();
    }, delay);
  }

  private async runAttempt(): Promise<void> {
    if (this.cancelled || this.finished) return;

    if (!this.opts.isInView()) {
      this.waitForViewport();
      return;
    }

    this.attemptIndex += 1;

    let success: boolean;
    try {
      success = await this.opts.attempt();
    } catch {
      success = false;
    }

    if (this.cancelled) return;
    if (success) {
      this.finished = true;
      return;
    }
    this.scheduleNext();
  }

  private waitForViewport(): void {
    if (this.waitingForViewport) return;
    const notifier = this.opts.viewportNotifier;
    if (!notifier) return;

    this.waitingForViewport = true;
    this.viewportUnsub = notifier(() => {
      if (!this.opts.isInView()) return;
      this.unsubscribeViewport();
      void this.runAttempt();
    });
  }

  private unsubscribeViewport(): void {
    if (this.viewportUnsub) {
      this.viewportUnsub();
      this.viewportUnsub = null;
    }
    this.waitingForViewport = false;
  }
}
