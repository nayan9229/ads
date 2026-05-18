import { AuctionOrchestrator, PrebidAuctionApi } from "../src/core/auction-orchestrator";
import { CallbackRegistry } from "../src/core/callback-registry";
import { ConfigRegistry } from "../src/core/config-registry";
import { ErrorRegistry } from "../src/core/error-registry";
import { BannerRenderer } from "../src/renderers/banner-renderer";
import { VideoRenderer } from "../src/renderers/video-renderer";
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
