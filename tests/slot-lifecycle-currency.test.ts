import { AuctionOrchestrator, PrebidAuctionApi } from "../src/core/auction-orchestrator";
import { CallbackRegistry } from "../src/core/callback-registry";
import { ConfigRegistry } from "../src/core/config-registry";
import { ErrorRegistry } from "../src/core/error-registry";
import { BannerRenderer } from "../src/renderers/banner-renderer";
import { SlotLifecycle } from "../src/core/slot-lifecycle";
import { CurrencyConverter } from "../src/core/currency-converter";

function makePbjs(winner: {
  adId: string;
  width: number;
  height: number;
  cpm: number;
  currency?: string;
}): PrebidAuctionApi & {
  renderAd: jest.Mock;
  requestBids: jest.Mock;
  getHighestCpmBids: jest.Mock;
} {
  return {
    addAdUnits: jest.fn(),
    requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler({})),
    getHighestCpmBids: jest.fn().mockReturnValue([winner]),
    renderAd: jest.fn(),
  };
}

describe("SlotLifecycle currency-enriched adRenderSuccess", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("adRenderSuccess payload includes cpm, cpmUsd, currency when converter present", async () => {
    const pbjs = makePbjs({
      adId: "bid_eur",
      width: 300,
      height: 250,
      cpm: 2,
      currency: "EUR",
    });
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const seen: unknown[] = [];
    callbacks.on("adRenderSuccess", (p) => seen.push(p));

    const orchestrator = new AuctionOrchestrator(pbjs);
    const registry = new ConfigRegistry();
    const config = registry.register("slot_eur", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);

    const converter = new CurrencyConverter({
      source: "https://x.example.com/fx.json",
      ttlMs: 86_400_000,
      fetchImpl: (async (): Promise<Response> =>
        ({
          ok: true,
          json: async () => ({ conversions: { USD: { EUR: 0.92 } } }),
        }) as unknown as Response) as unknown as typeof fetch,
    });
    await converter.init();

    const lifecycle = new SlotLifecycle({
      slotId: "slot_eur",
      config,
      container,
      callbacks,
      bannerRenderer: new BannerRenderer(pbjs, callbacks),
      pbjs,
      orchestrator,
      isInView: () => true,
      currencyConverter: converter,
    });

    lifecycle.start();
    await jest.advanceTimersByTimeAsync(50);

    expect(seen).toHaveLength(1);
    const payload = seen[0] as {
      slotId: string;
      cpm: number;
      currency: string;
      cpmUsd: number;
    };
    expect(payload).toMatchObject({
      slotId: "slot_eur",
      cpm: 2,
      currency: "EUR",
    });
    expect(payload.cpmUsd).toBeCloseTo(2 / 0.92, 6);
  });
});
