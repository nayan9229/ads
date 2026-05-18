import { AuctionOrchestrator, PrebidAuctionApi } from "../src/core/auction-orchestrator";
import { CallbackRegistry } from "../src/core/callback-registry";
import { ConfigRegistry } from "../src/core/config-registry";
import { ErrorRegistry } from "../src/core/error-registry";
import { BannerRenderer } from "../src/renderers/banner-renderer";
import { NativeRenderer } from "../src/renderers/native-renderer";
import { SlotLifecycle } from "../src/core/slot-lifecycle";

interface PbjsStub extends PrebidAuctionApi {
  renderAd: jest.Mock;
  requestBids: jest.Mock;
  getHighestCpmBids: jest.Mock;
}

function makeNativePbjs(): PbjsStub {
  return {
    addAdUnits: jest.fn(),
    requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler({})),
    getHighestCpmBids: jest.fn().mockReturnValue([
      {
        adId: "native_bid_z",
        cpm: 2,
        mediaType: "native",
        native: {
          title: "Title text",
          body: "Body text",
          cta: "Buy",
          sponsoredBy: "Brand",
          image: { url: "https://cdn.example.com/i.png" },
          clickUrl: "https://example.com/landing",
          impressionTrackers: [],
          clickTrackers: [],
        },
      },
    ]),
    renderAd: jest.fn(),
  };
}

describe("SlotLifecycle dispatches native bids to NativeRenderer", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("native config + native bid → NativeRenderer fills container with template DOM", async () => {
    const pbjs = makeNativePbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);
    const registry = new ConfigRegistry();
    const config = registry.register("slot_native_run", {
      mediaTypes: {
        native: {
          template: `<div class="card"><h3 class="t">{{title}}</h3></div>`,
          requiredAssets: ["title"],
        },
      },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);

    const lifecycle = new SlotLifecycle({
      slotId: "slot_native_run",
      config,
      container,
      callbacks,
      bannerRenderer: new BannerRenderer(pbjs, callbacks),
      nativeRenderer: new NativeRenderer(callbacks),
      pbjs,
      orchestrator,
      isInView: () => true,
    });

    lifecycle.start();
    await jest.advanceTimersByTimeAsync(50);

    expect(container.querySelector(".t")?.textContent).toBe("Title text");
    expect(pbjs.renderAd).not.toHaveBeenCalled();
  });
});
