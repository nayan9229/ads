import { Surface } from "../core/detect-environment";

export interface TrackOptions {
  readonly threshold: number;
  readonly durationMs: number;
}

interface SafeFrameExt {
  readonly inViewPercentage?: () => number;
  readonly geom?: () => unknown;
}

// Poll interval for the SafeFrame geometry API (P2/D65). IntersectionObserver is
// blind cross-origin, so a sandboxed creative reads `$sf.ext.inViewPercentage()`.
const SF_POLL_MS = 200;

export class ViewabilityTracker {
  // Cleanup for in-flight track() calls (IO disconnect / interval clear), so the
  // slot can cancel a pending measurement on destroy (D65) — otherwise a slot
  // that never becomes viewable leaks an observer or an active poll interval.
  private readonly disposers = new Set<() => void>();

  // Surface (D65) selects the measurement source: IntersectionObserver on `top`/
  // `friendly-iframe`, the SafeFrame `$sf.ext` geometry API on `safeframe`.
  constructor(private readonly surface: Surface = "top") {}

  track(el: Element, opts: TrackOptions): Promise<void> {
    if (this.surface === "safeframe") {
      const ext = this.safeFrameExt();
      if (ext && typeof ext.inViewPercentage === "function") {
        return this.trackViaSafeFrame(ext, opts);
      }
      // Defensive: a "safeframe" with no $sf host API — fall back to IO (blind,
      // but avoids a hard stall if detection over-classified a plain iframe).
    }
    return this.trackViaObserver(el, opts);
  }

  // Cancel all in-flight measurements (called on slot destroy). Pending track()
  // promises are intentionally left unresolved — their consumers already guard on
  // the destroyed flag; we only stop the underlying observer/timer.
  dispose(): void {
    for (const off of this.disposers) off();
    this.disposers.clear();
  }

  // Instantaneous in-view fraction [0,1], or null when not measurable synchronously
  // (IO gives no sync %). Used to stamp `ortb2Imp.ext.data.viewability` (#4).
  currentInView(): number | null {
    if (this.surface !== "safeframe") return null;
    const ext = this.safeFrameExt();
    return ext ? this.readInViewFraction(ext) : null;
  }

  // Single source of truth for reading + normalizing `$sf.ext.inViewPercentage()`
  // to a [0,1] fraction (or null). Shared by currentInView() and the poll so their
  // clamping/validation can't diverge.
  private readInViewFraction(ext: SafeFrameExt): number | null {
    if (typeof ext.inViewPercentage !== "function") return null;
    try {
      const pct = ext.inViewPercentage();
      if (typeof pct === "number" && pct >= 0) return Math.min(1, pct / 100);
    } catch {
      /* $sf call failed — treat as unknown */
    }
    return null;
  }

  private safeFrameExt(): SafeFrameExt | null {
    if (typeof window === "undefined") return null;
    const sf = (window as unknown as { $sf?: { ext?: SafeFrameExt } }).$sf;
    return sf && sf.ext ? sf.ext : null;
  }

  private trackViaSafeFrame(ext: SafeFrameExt, opts: TrackOptions): Promise<void> {
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const poll = setInterval(() => {
        const frac = this.readInViewFraction(ext);
        const meets = frac !== null && frac >= opts.threshold;
        if (meets) {
          if (timer === null) {
            timer = setTimeout(() => {
              cleanup();
              resolve();
            }, opts.durationMs);
          }
        } else if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      }, SF_POLL_MS);
      const cleanup = () => {
        clearInterval(poll);
        if (timer !== null) clearTimeout(timer);
        this.disposers.delete(cleanup);
      };
      this.disposers.add(cleanup);
    });
  }

  private trackViaObserver(el: Element, opts: TrackOptions): Promise<void> {
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const meets = entry.isIntersecting && entry.intersectionRatio >= opts.threshold;
            if (meets) {
              if (timer === null) {
                timer = setTimeout(() => {
                  cleanup();
                  resolve();
                }, opts.durationMs);
              }
            } else {
              if (timer !== null) {
                clearTimeout(timer);
                timer = null;
              }
            }
          }
        },
        { threshold: [0, opts.threshold] },
      );
      observer.observe(el);
      const cleanup = () => {
        observer.disconnect();
        if (timer !== null) clearTimeout(timer);
        this.disposers.delete(cleanup);
      };
      this.disposers.add(cleanup);
    });
  }
}
