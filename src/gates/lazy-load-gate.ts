export interface LazyLoadGateOptions {
  readonly rootMargin?: string;
}

export class LazyLoadGate {
  constructor(private readonly opts: LazyLoadGateOptions = {}) {}

  gate(el: Element): Promise<void> {
    return new Promise<void>((resolve) => {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              observer.disconnect();
              resolve();
              return;
            }
          }
        },
        { rootMargin: this.opts.rootMargin ?? "400px 0px", threshold: 0 },
      );
      observer.observe(el);
    });
  }
}
