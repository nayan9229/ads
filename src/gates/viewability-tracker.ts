export interface TrackOptions {
  readonly threshold: number;
  readonly durationMs: number;
}

export class ViewabilityTracker {
  track(el: Element, opts: TrackOptions): Promise<void> {
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const meets = entry.isIntersecting && entry.intersectionRatio >= opts.threshold;
            if (meets) {
              if (timer === null) {
                timer = setTimeout(() => {
                  observer.disconnect();
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
    });
  }
}
