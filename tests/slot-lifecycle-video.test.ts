import { AuctionOrchestrator, PrebidAuctionApi } from "../src/core/auction-orchestrator";
import { CallbackRegistry } from "../src/core/callback-registry";
import { ConfigRegistry } from "../src/core/config-registry";
import { ErrorRegistry } from "../src/core/error-registry";
import { BannerRenderer } from "../src/renderers/banner-renderer";
import { VideoRenderer, VideoBid } from "../src/renderers/video-renderer";
import { SlotLifecycle } from "../src/core/slot-lifecycle";

interface PbjsStub extends PrebidAuctionApi {
  renderAd: jest.Mock;
  requestBids: jest.Mock;
  getHighestCpmBids: jest.Mock;
}

function makePbjs(bid: { adId: string; vastUrl: string; cpm: number }): PbjsStub {
  return {
    addAdUnits: jest.fn(),
    requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler({})),
    getHighestCpmBids: jest.fn().mockReturnValue([{ ...bid, mediaType: "video" }]),
    renderAd: jest.fn(),
  };
}

function makeIma() {
  return {
    AdsLoader: jest.fn(function (this: unknown) {
      Object.assign(this as object, {
        requestAds: jest.fn(),
        addEventListener: jest.fn(),
        contentComplete: jest.fn(),
      });
    }),
    AdDisplayContainer: jest.fn(function (this: unknown) {
      Object.assign(this as object, { initialize: jest.fn() });
    }),
    AdsRequest: jest.fn(function (this: unknown) {
      Object.assign(this as object, {});
    }),
    AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: "adsManagerLoaded" } },
    AdEvent: { Type: { STARTED: "start", COMPLETE: "complete" } },
    AdErrorEvent: { Type: { AD_ERROR: "adError" } },
  };
}

describe("SlotLifecycle dispatches video bids to VideoRenderer", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("video config + video bid → VideoRenderer creates a <video> element and calls AdsLoader.requestAds", async () => {
    const pbjs = makePbjs({
      adId: "bid_v_l",
      vastUrl: "https://cdn.example.com/v.xml",
      cpm: 3,
    });
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);
    const registry = new ConfigRegistry();
    const config = registry.register("slot_video_lc", {
      mediaTypes: { video: { context: "outstream", playerSize: [640, 480] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const ima = makeIma();

    const lifecycle = new SlotLifecycle({
      slotId: "slot_video_lc",
      config,
      container,
      callbacks,
      bannerRenderer: new BannerRenderer(pbjs, callbacks),
      videoRenderer: new VideoRenderer(
        ima as unknown as ConstructorParameters<typeof VideoRenderer>[0],
        callbacks,
      ),
      pbjs,
      orchestrator,
      isInView: () => true,
    });

    lifecycle.start();
    await jest.advanceTimersByTimeAsync(50);

    expect(container.querySelector("video")).not.toBeNull();
    expect(pbjs.renderAd).not.toHaveBeenCalled();
  });
});

// P5 (D65): in a safeframe, a failed/refused outstream render falls back to banner.
describe("SlotLifecycle — safeframe video→banner fallback", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  function setup() {
    const pbjs: PbjsStub = {
      addAdUnits: jest.fn(),
      requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler({})),
      // After video is stripped, the re-auction resolves to a banner bid.
      getHighestCpmBids: jest.fn().mockReturnValue([{ adId: "banner_1", width: 300, height: 250, cpm: 2 }]),
      renderAd: jest.fn(),
    };
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);
    const config = new ConfigRegistry().register("slot_sf_v", {
      mediaTypes: {
        banner: { sizes: [[300, 250]] },
        video: { context: "outstream", playerSize: [640, 480] },
      },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const lifecycle = new SlotLifecycle({
      slotId: "slot_sf_v",
      config,
      container,
      callbacks,
      bannerRenderer: new BannerRenderer(pbjs, callbacks),
      videoRenderer: new VideoRenderer(
        makeIma() as unknown as ConstructorParameters<typeof VideoRenderer>[0],
        callbacks,
      ),
      pbjs,
      orchestrator,
      isInView: () => true,
      surface: "safeframe",
    });
    const videoBid = { adId: "vid_1", mediaType: "video", vastUrl: "https://x/v.xml", cpm: 3 };
    return { pbjs, callbacks, container, lifecycle, videoBid };
  }

  it("re-auctions banner-only when the outstream render fails", async () => {
    const { pbjs, callbacks, container, lifecycle, videoBid } = setup();

    lifecycle.onAuctionWon(videoBid as unknown as VideoBid);
    expect(container.querySelector("video")).not.toBeNull();

    // IMA fails / refuses inside the SafeFrame.
    callbacks.emit("adRenderFail", { slotId: "slot_sf_v", reason: "IMA AD_ERROR" });

    await jest.advanceTimersByTimeAsync(50); // debounced re-auction fires
    expect(pbjs.renderAd).toHaveBeenCalledTimes(1); // banner rendered
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(container.querySelector("video")).toBeNull(); // prior creative replaced
  });

  it("does NOT re-auction when the outstream render succeeds (guard disarmed)", async () => {
    const { pbjs, callbacks, lifecycle, videoBid } = setup();

    lifecycle.onAuctionWon(videoBid as unknown as VideoBid);
    callbacks.emit("adRenderSuccess", { slotId: "slot_sf_v", adId: "vid_1" });
    // A late failure after success must be ignored.
    callbacks.emit("adRenderFail", { slotId: "slot_sf_v", reason: "late" });

    await jest.advanceTimersByTimeAsync(50);
    expect(pbjs.addAdUnits).not.toHaveBeenCalled(); // no re-auction
  });

  it("does not arm the fallback on non-safeframe surfaces", async () => {
    const pbjs: PbjsStub = {
      addAdUnits: jest.fn(),
      requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler({})),
      getHighestCpmBids: jest.fn().mockReturnValue([{ adId: "b", width: 300, height: 250, cpm: 2 }]),
      renderAd: jest.fn(),
    };
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);
    const config = new ConfigRegistry().register("slot_top_v", {
      mediaTypes: {
        banner: { sizes: [[300, 250]] },
        video: { context: "outstream", playerSize: [640, 480] },
      },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const lifecycle = new SlotLifecycle({
      slotId: "slot_top_v",
      config,
      container,
      callbacks,
      bannerRenderer: new BannerRenderer(pbjs, callbacks),
      videoRenderer: new VideoRenderer(
        makeIma() as unknown as ConstructorParameters<typeof VideoRenderer>[0],
        callbacks,
      ),
      pbjs,
      orchestrator,
      isInView: () => true,
      // surface omitted → defaults to top
    });

    lifecycle.onAuctionWon({ adId: "vid_1", mediaType: "video", vastUrl: "https://x/v.xml", cpm: 3 } as unknown as VideoBid);
    callbacks.emit("adRenderFail", { slotId: "slot_top_v", reason: "IMA AD_ERROR" });

    await jest.advanceTimersByTimeAsync(50);
    expect(pbjs.addAdUnits).not.toHaveBeenCalled(); // no banner re-auction on `top`
  });
});

// D66: video refresh is triggered by the video ad completing (adComplete), not a
// timer, bounded by sessionCap.
describe("SlotLifecycle — video ad-complete refresh (D66)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  function setup(refresh: Record<string, unknown>, extraDeps: Record<string, unknown> = {}) {
    const pbjs: PbjsStub = {
      addAdUnits: jest.fn(),
      requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler({})),
      getHighestCpmBids: jest
        .fn()
        .mockReturnValue([{ adId: "v", mediaType: "video", vastUrl: "https://x/v.xml", cpm: 3 }]),
      renderAd: jest.fn(),
    };
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);
    const config = new ConfigRegistry().register("slot_vr", {
      mediaTypes: { video: { context: "outstream", playerSize: [640, 480], linearity: 1, refresh } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const events: string[] = [];
    ["refresh", "refresh_cap_reached"].forEach((e) =>
      callbacks.on(e as never, () => events.push(e)),
    );
    const lifecycle = new SlotLifecycle({
      slotId: "slot_vr",
      config,
      container,
      callbacks,
      bannerRenderer: new BannerRenderer(pbjs, callbacks),
      videoRenderer: new VideoRenderer(
        makeIma() as unknown as ConstructorParameters<typeof VideoRenderer>[0],
        callbacks,
      ),
      pbjs,
      orchestrator,
      isInView: () => true,
      ...extraDeps,
    });
    const videoBid = { adId: "v", mediaType: "video", vastUrl: "https://x/v.xml", cpm: 3 };
    return { pbjs, callbacks, lifecycle, events, videoBid };
  }

  it("re-auctions on each video ad-complete, up to sessionCap, then emits refresh_cap_reached", async () => {
    const { pbjs, callbacks, lifecycle, events, videoBid } = setup({ sessionCap: 2 });

    lifecycle.onAuctionWon(videoBid as unknown as VideoBid); // impression 0, arms the listener

    callbacks.emit("adComplete", { slotId: "slot_vr", mediaType: "video" }); // refresh #1
    await jest.advanceTimersByTimeAsync(50); // debounced re-auction → re-renders video → re-arms
    callbacks.emit("adComplete", { slotId: "slot_vr", mediaType: "video" }); // refresh #2 → hits cap
    await jest.advanceTimersByTimeAsync(50); // re-auction → capReached → does NOT re-arm
    callbacks.emit("adComplete", { slotId: "slot_vr", mediaType: "video" }); // no listener → ignored
    await jest.advanceTimersByTimeAsync(50);

    expect(events.filter((e) => e === "refresh")).toHaveLength(2);
    expect(events.filter((e) => e === "refresh_cap_reached")).toHaveLength(1);
    expect(pbjs.requestBids).toHaveBeenCalledTimes(2); // exactly two re-auctions
  });

  it("refreshes on adSkipped (user skip triggers a re-auction too)", async () => {
    const { pbjs, callbacks, lifecycle, events, videoBid } = setup({ sessionCap: 5 });
    lifecycle.onAuctionWon(videoBid as unknown as VideoBid);
    callbacks.emit("adSkipped", { slotId: "slot_vr", mediaType: "video" });
    await jest.advanceTimersByTimeAsync(50);
    expect(events.filter((e) => e === "refresh")).toHaveLength(1);
    expect(pbjs.requestBids).toHaveBeenCalledTimes(1);
  });

  it("counts completions AND skips toward the same sessionCap", async () => {
    const { pbjs, callbacks, lifecycle, events, videoBid } = setup({ sessionCap: 2 });
    lifecycle.onAuctionWon(videoBid as unknown as VideoBid);

    callbacks.emit("adComplete", { slotId: "slot_vr", mediaType: "video" }); // refresh #1 (complete)
    await jest.advanceTimersByTimeAsync(50);
    callbacks.emit("adSkipped", { slotId: "slot_vr", mediaType: "video" }); // refresh #2 (skip) → cap
    await jest.advanceTimersByTimeAsync(50);
    callbacks.emit("adComplete", { slotId: "slot_vr", mediaType: "video" }); // over cap → ignored
    await jest.advanceTimersByTimeAsync(50);

    expect(events.filter((e) => e === "refresh")).toHaveLength(2);
    expect(events.filter((e) => e === "refresh_cap_reached")).toHaveLength(1);
    expect(pbjs.requestBids).toHaveBeenCalledTimes(2);
  });

  it("refreshes unbounded (no sessionCap) on each completion", async () => {
    const { pbjs, callbacks, lifecycle, events, videoBid } = setup({});
    lifecycle.onAuctionWon(videoBid as unknown as VideoBid);
    for (let i = 0; i < 4; i++) {
      callbacks.emit("adComplete", { slotId: "slot_vr", mediaType: "video" });
      await jest.advanceTimersByTimeAsync(50);
    }
    expect(events.filter((e) => e === "refresh")).toHaveLength(4);
    expect(events.filter((e) => e === "refresh_cap_reached")).toHaveLength(0);
    expect(pbjs.requestBids).toHaveBeenCalledTimes(4);
  });

  it("suppressRefresh (webview) disables video ad-complete refresh", async () => {
    const { pbjs, callbacks, lifecycle, events, videoBid } = setup({ sessionCap: 5 }, { suppressRefresh: true });
    lifecycle.onAuctionWon(videoBid as unknown as VideoBid);
    callbacks.emit("adComplete", { slotId: "slot_vr", mediaType: "video" });
    await jest.advanceTimersByTimeAsync(100);
    expect(events).toHaveLength(0);
    expect(pbjs.requestBids).not.toHaveBeenCalled();
  });
});
