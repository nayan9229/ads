import { AuctionOrchestrator, PrebidAuctionApi } from "../src/core/auction-orchestrator";
import { CallbackRegistry } from "../src/core/callback-registry";
import { ConfigRegistry } from "../src/core/config-registry";
import { ErrorRegistry } from "../src/core/error-registry";
import { BannerRenderer } from "../src/renderers/banner-renderer";
import { SlotLifecycle } from "../src/core/slot-lifecycle";
import { LazyLoadGate } from "../src/gates/lazy-load-gate";
import { ConsentManager } from "../src/core/consent-manager";
import {
  installIntersectionObserverStub,
  uninstallIntersectionObserverStub,
  triggerEntry,
} from "./helpers/iox-stub";

function makePbjs(): PrebidAuctionApi & { renderAd: jest.Mock; requestBids: jest.Mock } {
  return {
    addAdUnits: jest.fn(),
    requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler({})),
    getHighestCpmBids: jest
      .fn()
      .mockReturnValue([{ adId: "bid_x", width: 300, height: 250, cpm: 1 }]),
    renderAd: jest.fn(),
  };
}

describe("SlotLifecycle consent + lazy dual gating", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    jest.useFakeTimers();
    installIntersectionObserverStub();
    delete (window as unknown as { __tcfapi?: unknown }).__tcfapi;
    delete (window as unknown as { __uspapi?: unknown }).__uspapi;
  });
  afterEach(() => {
    jest.useRealTimers();
    uninstallIntersectionObserverStub();
  });

  it("lazy slot must satisfy BOTH lazy gate and consent resolution before bidding", async () => {
    const pbjs = makePbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);
    const registry = new ConfigRegistry();
    const config = registry.register("slot_dual", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
    });
    const container = document.createElement("div");
    document.body.appendChild(container);

    const lifecycle = new SlotLifecycle({
      slotId: "slot_dual",
      config,
      container,
      callbacks,
      bannerRenderer: new BannerRenderer(pbjs, callbacks),
      pbjs,
      orchestrator,
      isInView: () => true,
      lazyLoadGate: new LazyLoadGate(),
      consentManager: new ConsentManager({ timeoutMs: 1000, timezone: "America/New_York" }),
    });

    lifecycle.start();

    // Trigger lazy intersection — consent still pending.
    triggerEntry(container, true);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(50);
    expect(pbjs.requestBids).not.toHaveBeenCalled();

    // Resolve consent (1s timeout).
    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(50);

    expect(pbjs.requestBids).toHaveBeenCalledTimes(1);
  });

  it("emits E_NO_CMP error and never enqueues when consent is blocked", async () => {
    const pbjs = makePbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);
    const registry = new ConfigRegistry();
    const config = registry.register("slot_blocked", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);

    const errors: unknown[] = [];
    callbacks.on("error", (p) => errors.push(p));

    const lifecycle = new SlotLifecycle({
      slotId: "slot_blocked",
      config,
      container,
      callbacks,
      bannerRenderer: new BannerRenderer(pbjs, callbacks),
      pbjs,
      orchestrator,
      isInView: () => true,
      consentManager: new ConsentManager({ timeoutMs: 1000, timezone: "Europe/Paris" }),
    });

    lifecycle.start();
    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(100);

    expect(pbjs.requestBids).not.toHaveBeenCalled();
    expect(errors).toEqual([
      {
        slotId: "slot_blocked",
        code: "E_NO_CMP",
        message: "consent blocked auction",
      },
    ]);
  });
});
