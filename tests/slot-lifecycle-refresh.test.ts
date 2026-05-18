import { AuctionOrchestrator, PrebidAuctionApi } from "../src/core/auction-orchestrator";
import { CallbackRegistry } from "../src/core/callback-registry";
import { ConfigRegistry } from "../src/core/config-registry";
import { ErrorRegistry } from "../src/core/error-registry";
import { BannerRenderer } from "../src/renderers/banner-renderer";
import { SlotLifecycle } from "../src/core/slot-lifecycle";
import { ViewabilityTracker } from "../src/gates/viewability-tracker";
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

describe("SlotLifecycle refresh wiring", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    jest.useFakeTimers();
    installIntersectionObserverStub();
  });
  afterEach(() => {
    jest.useRealTimers();
    uninstallIntersectionObserverStub();
  });

  it("does not refresh until viewable event fires for the prior impression", async () => {
    const pbjs = makePbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);
    const registry = new ConfigRegistry();
    const config = registry.register("slot_rf", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
      refresh: { intervalSec: 30 },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);

    const lifecycle = new SlotLifecycle({
      slotId: "slot_rf",
      config,
      container,
      callbacks,
      bannerRenderer: new BannerRenderer(pbjs, callbacks),
      pbjs,
      orchestrator,
      isInView: () => true,
      viewabilityTracker: new ViewabilityTracker(),
    });

    lifecycle.start();
    await jest.advanceTimersByTimeAsync(50);
    expect(pbjs.requestBids).toHaveBeenCalledTimes(1);

    // Container not yet viewable. Advance 60 seconds: no refresh because viewable never fired.
    await jest.advanceTimersByTimeAsync(60_000);
    expect(pbjs.requestBids).toHaveBeenCalledTimes(1);

    // Now fire viewable.
    triggerEntry(container, true, 0.7);
    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    // After viewable, refresh timer starts.
    await jest.advanceTimersByTimeAsync(30_000);
    await jest.advanceTimersByTimeAsync(50);
    expect(pbjs.requestBids).toHaveBeenCalledTimes(2);
  });

  it("emits refresh_cap_reached when sessionCap fires exhaust the scheduler", async () => {
    const pbjs = makePbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);
    const registry = new ConfigRegistry({ minRefreshIntervalSec: 1 });
    const config = registry.register("slot_rfcap", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
      refresh: { intervalSec: 1, sessionCap: 2 },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);

    const events: unknown[] = [];
    callbacks.on("refresh_cap_reached", (p) => events.push(p));

    const lifecycle = new SlotLifecycle({
      slotId: "slot_rfcap",
      config,
      container,
      callbacks,
      bannerRenderer: new BannerRenderer(pbjs, callbacks),
      pbjs,
      orchestrator,
      isInView: () => true,
      viewabilityTracker: new ViewabilityTracker(),
    });

    lifecycle.start();
    await jest.advanceTimersByTimeAsync(50);

    triggerEntry(container, true, 0.7);
    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    // Two refresh fires, then cap reached.
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(50);
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(50);

    expect(events).toEqual([{ slotId: "slot_rfcap", cap: 2 }]);
  });

  it("webview environment suppresses refresh entirely", async () => {
    const pbjs = makePbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);
    const registry = new ConfigRegistry({ minRefreshIntervalSec: 1 });
    const config = registry.register("slot_wv_rf", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
      refresh: { intervalSec: 1 },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);

    const lifecycle = new SlotLifecycle({
      slotId: "slot_wv_rf",
      config,
      container,
      callbacks,
      bannerRenderer: new BannerRenderer(pbjs, callbacks),
      pbjs,
      orchestrator,
      isInView: () => true,
      viewabilityTracker: new ViewabilityTracker(),
      suppressRefresh: true,
    });

    lifecycle.start();
    await jest.advanceTimersByTimeAsync(50);
    triggerEntry(container, true, 0.7);
    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    expect(pbjs.requestBids).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(10_000);
    expect(pbjs.requestBids).toHaveBeenCalledTimes(1);
  });

  it("destroy() cancels the refresh scheduler — no further refresh fires", async () => {
    const pbjs = makePbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);
    const registry = new ConfigRegistry();
    const config = registry.register("slot_rf2", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
      refresh: { intervalSec: 30 },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);

    const lifecycle = new SlotLifecycle({
      slotId: "slot_rf2",
      config,
      container,
      callbacks,
      bannerRenderer: new BannerRenderer(pbjs, callbacks),
      pbjs,
      orchestrator,
      isInView: () => true,
      viewabilityTracker: new ViewabilityTracker(),
    });

    lifecycle.start();
    await jest.advanceTimersByTimeAsync(50);

    triggerEntry(container, true, 0.7);
    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    expect(pbjs.requestBids).toHaveBeenCalledTimes(1);

    lifecycle.destroy();

    await jest.advanceTimersByTimeAsync(60_000);
    expect(pbjs.requestBids).toHaveBeenCalledTimes(1);
  });
});
