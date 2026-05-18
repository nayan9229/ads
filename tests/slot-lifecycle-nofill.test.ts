import { AuctionOrchestrator, PrebidAuctionApi } from "../src/core/auction-orchestrator";
import { ConfigRegistry } from "../src/core/config-registry";
import { CallbackRegistry } from "../src/core/callback-registry";
import { ErrorRegistry } from "../src/core/error-registry";
import { BannerRenderer } from "../src/renderers/banner-renderer";
import { SlotLifecycle } from "../src/core/slot-lifecycle";

const DELAYS = [1000, 2000, 4000, 8000, 16000];

function makeStubPbjs(): PrebidAuctionApi & { renderAd: jest.Mock; requestBids: jest.Mock } {
  return {
    addAdUnits: jest.fn(),
    requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler({})),
    getHighestCpmBids: jest.fn().mockReturnValue([]),
    renderAd: jest.fn(),
  };
}

describe("SlotLifecycle no-fill branch wired to RetryScheduler", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("re-runs auction at 1/2/4/8/16s on no-fill; emits noFill exactly once at terminal", async () => {
    const pbjs = makeStubPbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const noFillEvents: unknown[] = [];
    callbacks.on("noFill", (p) => noFillEvents.push(p));

    const orchestrator = new AuctionOrchestrator(pbjs);
    const registry = new ConfigRegistry();
    const config = registry.register("slot_nofill", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
    });
    const container = document.createElement("div");
    document.body.appendChild(container);

    const lifecycle = new SlotLifecycle({
      slotId: "slot_nofill",
      config,
      container,
      callbacks,
      bannerRenderer: new BannerRenderer(pbjs, callbacks),
      pbjs,
      orchestrator,
      retryDelaysMs: DELAYS,
      isInView: () => true,
    });

    orchestrator.enqueue({ slotId: "slot_nofill", config, lifecycle });

    // Initial 50ms debounce
    await jest.advanceTimersByTimeAsync(50);
    expect(pbjs.requestBids).toHaveBeenCalledTimes(1);

    for (const ms of DELAYS) {
      await jest.advanceTimersByTimeAsync(ms);
      // Each retry triggers debounce + auction
      await jest.advanceTimersByTimeAsync(50);
    }

    expect(pbjs.requestBids).toHaveBeenCalledTimes(6); // initial + 5 retries
    expect(noFillEvents).toHaveLength(1);
    expect(noFillEvents[0]).toEqual({ slotId: "slot_nofill" });
  });

  it("on terminal no-fill, renders fallback image when configured", async () => {
    const pbjs = makeStubPbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);
    const registry = new ConfigRegistry();
    const config = registry.register("slot_fb", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
      fallback: {
        type: "image",
        url: "https://cdn.example.com/house.png",
        clickUrl: "https://example.com/landing",
      },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);

    const lifecycle = new SlotLifecycle({
      slotId: "slot_fb",
      config,
      container,
      callbacks,
      bannerRenderer: new BannerRenderer(pbjs, callbacks),
      pbjs,
      orchestrator,
      retryDelaysMs: DELAYS,
      isInView: () => true,
    });

    orchestrator.enqueue({ slotId: "slot_fb", config, lifecycle });
    await jest.advanceTimersByTimeAsync(50);
    for (const ms of DELAYS) {
      await jest.advanceTimersByTimeAsync(ms);
      await jest.advanceTimersByTimeAsync(50);
    }

    const img = container.querySelector("img") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.src).toBe("https://cdn.example.com/house.png");

    const link = container.querySelector("a") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.href).toBe("https://example.com/landing");
  });
});
