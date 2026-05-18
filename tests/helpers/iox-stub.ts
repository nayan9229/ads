// Test helper: synthetic IntersectionObserver for jsdom.
// Exposes manual trigger API to fire entries on demand.

export interface SyntheticEntry {
  readonly target: Element;
  readonly isIntersecting: boolean;
  readonly intersectionRatio: number;
}

type Cb = (entries: SyntheticEntry[], observer: SyntheticObserver) => void;

class SyntheticObserver {
  private readonly targets = new Set<Element>();

  constructor(
    private readonly cb: Cb,
    readonly options: IntersectionObserverInit | undefined,
  ) {
    registry.add(this);
  }

  observe(el: Element): void {
    this.targets.add(el);
  }

  unobserve(el: Element): void {
    this.targets.delete(el);
  }

  disconnect(): void {
    this.targets.clear();
    registry.delete(this);
  }

  has(el: Element): boolean {
    return this.targets.has(el);
  }

  fire(entries: SyntheticEntry[]): void {
    const filtered = entries.filter((e) => this.targets.has(e.target));
    if (filtered.length > 0) this.cb(filtered, this);
  }
}

const registry = new Set<SyntheticObserver>();

export function installIntersectionObserverStub(): void {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    SyntheticObserver as unknown as typeof IntersectionObserver;
}

export function uninstallIntersectionObserverStub(): void {
  registry.clear();
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
}

export function triggerEntry(el: Element, isIntersecting: boolean, ratio?: number): void {
  const entries: SyntheticEntry[] = [
    {
      target: el,
      isIntersecting,
      intersectionRatio: ratio ?? (isIntersecting ? 1 : 0),
    },
  ];
  for (const obs of registry) obs.fire(entries);
}
