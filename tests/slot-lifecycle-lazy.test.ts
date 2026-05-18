import { AuctionOrchestrator, PrebidAuctionApi } from "../src/core/auction-orchestrator";
import { CallbackRegistry } from "../src/core/callback-registry";
import { ConfigRegistry } from "../src/core/config-registry";
import { ErrorRegistry } from "../src/core/error-registry";
import { BannerRenderer } from "../src/renderers/banner-renderer";
import { SlotLifecycle } from "../src/core/slot-lifecycle";
import { LazyLoadGate } from "../src/gates/lazy-load-gate";
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

function setupSlot(slotId: string, eager: boolean | undefined) {
  const pbjs = makePbjs();
  const callbacks = new CallbackRegistry(new ErrorRegistry());
  const orchestrator = new AuctionOrchestrator(pbjs);
  const registry = new ConfigRegistry();
  const config = registry.register(slotId, {
    mediaTypes: { banner: { sizes: [[300, 250]] } },
    bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
    ...(eager !== undefined ? { eager } : {}),
  });
  const container = document.createElement("div");
  document.body.appendChild(container);

  const lifecycle = new SlotLifecycle({
    slotId,
    config,
    container,
    callbacks,
    bannerRenderer: new BannerRenderer(pbjs, callbacks),
    pbjs,
    orchestrator,
    isInView: () => true,
    lazyLoadGate: new LazyLoadGate(),
  });

  return { pbjs, callbacks, orchestrator, lifecycle, config, container };
}

describe("SlotLifecycle lazy/eager gating", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    jest.useFakeTimers();
    installIntersectionObserverStub();
  });
  afterEach(() => {
    jest.useRealTimers();
    uninstallIntersectionObserverStub();
  });

  it("lazy slot does not start auction until container intersects viewport", async () => {
    const { pbjs, orchestrator, lifecycle, config, container } = setupSlot("slot_lazy", undefined);

    lifecycle.start();
    await jest.advanceTimersByTimeAsync(50);
    expect(pbjs.requestBids).not.toHaveBeenCalled();

    triggerEntry(container, true);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(50);

    expect(pbjs.requestBids).toHaveBeenCalledTimes(1);
    void orchestrator;
    void config;
  });

  it("eager slot starts auction immediately after debounce (no gate wait)", async () => {
    const { pbjs, lifecycle } = setupSlot("slot_eager", true);

    lifecycle.start();
    await jest.advanceTimersByTimeAsync(50);

    expect(pbjs.requestBids).toHaveBeenCalledTimes(1);
  });

  it("emits viewable callback after sustained 1s ≥50% visibility post-render", async () => {
    const pbjs = makePbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);
    const registry = new ConfigRegistry();
    const config = registry.register("slot_view", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);

    const seen: unknown[] = [];
    callbacks.on("viewable", (p) => seen.push(p));

    const lifecycle = new SlotLifecycle({
      slotId: "slot_view",
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

    // Render completes — now viewability tracker begins observing
    triggerEntry(container, true, 0.7);
    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    expect(seen).toEqual([{ slotId: "slot_view" }]);
  });
});
