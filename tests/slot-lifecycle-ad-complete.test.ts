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

function makePbjs(): PrebidAuctionApi & { renderAd: jest.Mock } {
  return {
    addAdUnits: jest.fn(),
    requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler({})),
    getHighestCpmBids: jest
      .fn()
      .mockReturnValue([{ adId: "bid_x", width: 300, height: 250, cpm: 1 }]),
    renderAd: jest.fn(),
  };
}

function makeLifecycle(
  slotId: string,
  pbjs: ReturnType<typeof makePbjs>,
  config: ReturnType<InstanceType<typeof ConfigRegistry>["register"]>,
  callbacks: CallbackRegistry,
  extra: { viewabilityTracker?: ViewabilityTracker } = {},
) {
  const orchestrator = new AuctionOrchestrator(pbjs);
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
    ...extra,
  });
  return { lifecycle, container };
}

describe("adComplete — banner timer (no refresh)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("fires adComplete after default 10 000 ms following banner render", async () => {
    const pbjs = makePbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const config = new ConfigRegistry().register("slot_ac_def", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
    });

    const seen: unknown[] = [];
    callbacks.on("adComplete", (p) => seen.push(p));

    const { lifecycle } = makeLifecycle("slot_ac_def", pbjs, config, callbacks);
    lifecycle.start();
    await jest.advanceTimersByTimeAsync(50);

    expect(seen).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(10_000);

    expect(seen).toEqual([{ slotId: "slot_ac_def", mediaType: "banner" }]);
  });

  it("fires adComplete after custom adCompleteDelayMs", async () => {
    const pbjs = makePbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const config = new ConfigRegistry().register("slot_ac_custom", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
      adCompleteDelayMs: 5_000,
    });

    const seen: unknown[] = [];
    callbacks.on("adComplete", (p) => seen.push(p));

    const { lifecycle } = makeLifecycle("slot_ac_custom", pbjs, config, callbacks);
    lifecycle.start();
    await jest.advanceTimersByTimeAsync(50);

    await jest.advanceTimersByTimeAsync(4_999);
    expect(seen).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(1);
    expect(seen).toEqual([{ slotId: "slot_ac_custom", mediaType: "banner" }]);
  });

  it("does not fire adComplete before the delay elapses", async () => {
    const pbjs = makePbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const config = new ConfigRegistry().register("slot_ac_early", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
    });

    const seen: unknown[] = [];
    callbacks.on("adComplete", (p) => seen.push(p));

    const { lifecycle } = makeLifecycle("slot_ac_early", pbjs, config, callbacks);
    lifecycle.start();
    await jest.advanceTimersByTimeAsync(50);

    await jest.advanceTimersByTimeAsync(9_999);
    expect(seen).toHaveLength(0);
  });

  it("cancels the adComplete timer when destroy() is called before it fires", async () => {
    const pbjs = makePbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const config = new ConfigRegistry().register("slot_ac_destroy", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
    });

    const seen: unknown[] = [];
    callbacks.on("adComplete", (p) => seen.push(p));

    const { lifecycle } = makeLifecycle("slot_ac_destroy", pbjs, config, callbacks);
    lifecycle.start();
    await jest.advanceTimersByTimeAsync(50);

    lifecycle.destroy();

    await jest.advanceTimersByTimeAsync(15_000);
    expect(seen).toHaveLength(0);
  });

  it("destroy() leaves no pending timers", async () => {
    const pbjs = makePbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const config = new ConfigRegistry().register("slot_ac_leak", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
    });

    const { lifecycle } = makeLifecycle("slot_ac_leak", pbjs, config, callbacks);
    lifecycle.start();
    await jest.advanceTimersByTimeAsync(50);

    expect(jest.getTimerCount()).toBeGreaterThan(0);
    lifecycle.destroy();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("adComplete — banner timer with refresh", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    jest.useFakeTimers();
    installIntersectionObserverStub();
  });
  afterEach(() => {
    jest.useRealTimers();
    uninstallIntersectionObserverStub();
  });

  it("does not fire adComplete on intermediate renders when sessionCap is not yet reached", async () => {
    const pbjs = makePbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const config = new ConfigRegistry({ minRefreshIntervalSec: 1 }).register("slot_ac_mid", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
      refresh: { intervalSec: 1, sessionCap: 2 },
    });

    const seen: unknown[] = [];
    callbacks.on("adComplete", (p) => seen.push(p));

    const { lifecycle, container } = makeLifecycle("slot_ac_mid", pbjs, config, callbacks, {
      viewabilityTracker: new ViewabilityTracker(),
    });

    lifecycle.start();
    await jest.advanceTimersByTimeAsync(50);

    triggerEntry(container, true, 0.7);
    await jest.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();

    // First refresh fires — cap not yet reached.
    await jest.advanceTimersByTimeAsync(1_000);
    await jest.advanceTimersByTimeAsync(50);

    // Advance 10s: adComplete must not fire because cap not reached yet.
    await jest.advanceTimersByTimeAsync(10_000);
    expect(seen).toHaveLength(0);
  });

  it("fires adComplete once after the last refresh cycle render + delay when sessionCap is reached", async () => {
    const pbjs = makePbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const config = new ConfigRegistry({ minRefreshIntervalSec: 1 }).register("slot_ac_cap", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
      refresh: { intervalSec: 1, sessionCap: 2 },
    });

    const seen: unknown[] = [];
    callbacks.on("adComplete", (p) => seen.push(p));

    const { lifecycle, container } = makeLifecycle("slot_ac_cap", pbjs, config, callbacks, {
      viewabilityTracker: new ViewabilityTracker(),
    });

    lifecycle.start();
    await jest.advanceTimersByTimeAsync(50);

    triggerEntry(container, true, 0.7);
    await jest.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();

    // Two refresh ticks → cap reached after second.
    await jest.advanceTimersByTimeAsync(1_000);
    await jest.advanceTimersByTimeAsync(50);
    await jest.advanceTimersByTimeAsync(1_000);
    await jest.advanceTimersByTimeAsync(50);

    expect(seen).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(10_000);

    expect(seen).toEqual([{ slotId: "slot_ac_cap", mediaType: "banner" }]);
  });

  it("never fires adComplete when refresh is configured without sessionCap", async () => {
    const pbjs = makePbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const config = new ConfigRegistry({ minRefreshIntervalSec: 1 }).register("slot_ac_nocap", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
      refresh: { intervalSec: 1 },
    });

    const seen: unknown[] = [];
    callbacks.on("adComplete", (p) => seen.push(p));

    const { lifecycle, container } = makeLifecycle("slot_ac_nocap", pbjs, config, callbacks, {
      viewabilityTracker: new ViewabilityTracker(),
    });

    lifecycle.start();
    await jest.advanceTimersByTimeAsync(50);

    triggerEntry(container, true, 0.7);
    await jest.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();

    // Several refresh cycles, no cap ever set.
    await jest.advanceTimersByTimeAsync(5_000);
    await jest.advanceTimersByTimeAsync(10_000);

    expect(seen).toHaveLength(0);
  });
});
