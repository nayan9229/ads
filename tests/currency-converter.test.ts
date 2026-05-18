import { CurrencyConverter } from "../src/core/currency-converter";

interface FetchStub {
  mock: jest.Mock;
}

function makeFetchStub(payload: unknown): FetchStub {
  const mock = jest.fn(
    async (_url?: string | URL | Request): Promise<Response> =>
      ({
        ok: true,
        json: async () => payload,
      }) as unknown as Response,
  );
  return { mock };
}

describe("CurrencyConverter", () => {
  it("init() fetches the configured source once", async () => {
    const stub = makeFetchStub({ conversions: { USD: { EUR: 0.92 } } });
    const converter = new CurrencyConverter({
      source: "https://currency.prebid.org/latest.json",
      ttlMs: 86_400_000,
      fetchImpl: stub.mock as unknown as typeof fetch,
      getNow: () => 1_000,
    });

    await converter.init();

    expect(stub.mock).toHaveBeenCalledTimes(1);
    expect(stub.mock).toHaveBeenCalledWith("https://currency.prebid.org/latest.json");
  });

  it("toUSD with USD returns the input amount unchanged", async () => {
    const stub = makeFetchStub({ conversions: { USD: { EUR: 0.92 } } });
    const converter = new CurrencyConverter({
      source: "https://x.example.com/fx.json",
      ttlMs: 86_400_000,
      fetchImpl: stub.mock as unknown as typeof fetch,
      getNow: () => 1_000,
    });
    await converter.init();

    expect(converter.toUSD(1, "USD")).toBe(1);
    expect(converter.toUSD(7.5, "USD")).toBe(7.5);
  });

  it("toUSD with EUR divides by the USD→EUR rate", async () => {
    const stub = makeFetchStub({ conversions: { USD: { EUR: 0.92 } } });
    const converter = new CurrencyConverter({
      source: "https://x.example.com/fx.json",
      ttlMs: 86_400_000,
      fetchImpl: stub.mock as unknown as typeof fetch,
      getNow: () => 1_000,
    });
    await converter.init();

    // 1 EUR → 1 / 0.92 USD ≈ 1.0869...
    expect(converter.toUSD(1, "EUR")).toBeCloseTo(1 / 0.92, 8);
  });

  it("toUSD with an unknown currency returns the input unchanged", async () => {
    const stub = makeFetchStub({ conversions: { USD: { EUR: 0.92 } } });
    const converter = new CurrencyConverter({
      source: "https://x.example.com/fx.json",
      ttlMs: 86_400_000,
      fetchImpl: stub.mock as unknown as typeof fetch,
      getNow: () => 1_000,
    });
    await converter.init();

    expect(converter.toUSD(2, "XYZ")).toBe(2);
  });

  it("init() within TTL does not refetch", async () => {
    const stub = makeFetchStub({ conversions: { USD: { EUR: 0.92 } } });
    let now = 1_000;
    const converter = new CurrencyConverter({
      source: "https://x.example.com/fx.json",
      ttlMs: 86_400_000,
      fetchImpl: stub.mock as unknown as typeof fetch,
      getNow: () => now,
    });

    await converter.init();
    expect(stub.mock).toHaveBeenCalledTimes(1);

    now += 86_400_000 - 1; // just under TTL
    await converter.init();
    expect(stub.mock).toHaveBeenCalledTimes(1);
  });

  it("init() past TTL refetches", async () => {
    const stub = makeFetchStub({ conversions: { USD: { EUR: 0.92 } } });
    let now = 1_000;
    const converter = new CurrencyConverter({
      source: "https://x.example.com/fx.json",
      ttlMs: 86_400_000,
      fetchImpl: stub.mock as unknown as typeof fetch,
      getNow: () => now,
    });

    await converter.init();
    expect(stub.mock).toHaveBeenCalledTimes(1);

    now += 86_400_000 + 1;
    await converter.init();
    expect(stub.mock).toHaveBeenCalledTimes(2);
  });

  it("preserves cached rates when a later init() fetch fails", async () => {
    const goodPayload = { conversions: { USD: { EUR: 0.92 } } };
    let callIndex = 0;
    const mock = jest.fn(async (): Promise<Response> => {
      const i = callIndex++;
      if (i === 0) {
        return { ok: true, json: async () => goodPayload } as unknown as Response;
      }
      throw new Error("network down");
    });

    let now = 1_000;
    const converter = new CurrencyConverter({
      source: "https://x.example.com/fx.json",
      ttlMs: 86_400_000,
      fetchImpl: mock as unknown as typeof fetch,
      getNow: () => now,
    });

    await converter.init();
    expect(converter.toUSD(1, "EUR")).toBeCloseTo(1 / 0.92, 8);

    now += 86_400_000 + 1;
    await converter.init();
    // Cache intact despite failed refetch.
    expect(converter.toUSD(1, "EUR")).toBeCloseTo(1 / 0.92, 8);
  });
});
