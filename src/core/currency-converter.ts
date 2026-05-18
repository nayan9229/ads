export interface CurrencyConverterOptions {
  readonly source: string;
  readonly ttlMs: number;
  readonly fetchImpl?: typeof fetch;
  readonly getNow?: () => number;
}

interface FxPayload {
  readonly conversions?: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export class CurrencyConverter {
  private readonly getNow: () => number;
  private conversions: Readonly<Record<string, number>> = {};
  private fetchedAt = 0;

  constructor(private readonly opts: CurrencyConverterOptions) {
    this.getNow = opts.getNow ?? Date.now;
  }

  async init(): Promise<void> {
    const now = this.getNow();
    if (this.fetchedAt > 0 && now - this.fetchedAt < this.opts.ttlMs) return;

    const fetchFn =
      this.opts.fetchImpl ??
      (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
    if (!fetchFn) return;

    try {
      const res = await fetchFn(this.opts.source);
      const data = (await res.json()) as FxPayload;
      const usd = data.conversions?.["USD"];
      if (usd) {
        this.conversions = { ...usd };
        this.fetchedAt = now;
      }
    } catch {
      // Preserve cache on failure.
    }
  }

  toUSD(amount: number, currency: string): number {
    if (currency === "USD") return amount;
    const rate = this.conversions[currency];
    if (typeof rate !== "number" || rate === 0) return amount;
    return amount / rate;
  }

  isStale(): boolean {
    return this.getNow() - this.fetchedAt >= this.opts.ttlMs;
  }
}
