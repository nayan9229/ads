import { VideoRenderer } from "../src/renderers/video-renderer";
import { CallbackRegistry } from "../src/core/callback-registry";
import { ErrorRegistry } from "../src/core/error-registry";

interface FakeAdsLoader {
  requestAds: jest.Mock;
  addEventListener: jest.Mock;
  contentComplete: jest.Mock;
}

interface FakeImaModule {
  AdsLoader: jest.Mock;
  AdDisplayContainer: jest.Mock;
  AdsRequest: jest.Mock;
  AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: "adsManagerLoaded" } };
  AdEvent: {
    Type: { STARTED: "start"; COMPLETE: "complete"; AD_PROGRESS: "adProgress" };
  };
  AdErrorEvent: { Type: { AD_ERROR: "adError" } };
}

function makeImaStub(): FakeImaModule & { lastAdsLoader: FakeAdsLoader | null } {
  let lastAdsLoader: FakeAdsLoader | null = null;
  return {
    AdsLoader: jest.fn(function (this: unknown) {
      const fake: FakeAdsLoader = {
        requestAds: jest.fn(),
        addEventListener: jest.fn(),
        contentComplete: jest.fn(),
      };
      lastAdsLoader = fake;
      Object.assign(this as object, fake);
    }) as unknown as jest.Mock,
    AdDisplayContainer: jest.fn(function (this: unknown) {
      Object.assign(this as object, { initialize: jest.fn() });
    }) as unknown as jest.Mock,
    AdsRequest: jest.fn(function (this: unknown) {
      Object.assign(this as object, {});
    }) as unknown as jest.Mock,
    AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: "adsManagerLoaded" } },
    AdEvent: { Type: { STARTED: "start", COMPLETE: "complete", AD_PROGRESS: "adProgress" } },
    AdErrorEvent: { Type: { AD_ERROR: "adError" } },
    get lastAdsLoader() {
      return lastAdsLoader;
    },
  };
}

describe("VideoRenderer", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("creates a <video> element with muted/playsinline/autoplay attributes inside container", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const ima = makeImaStub();

    const renderer = new VideoRenderer(
      ima as unknown as ConstructorParameters<typeof VideoRenderer>[0],
      callbacks,
    );
    renderer.render({
      container,
      bid: { adId: "bid_v", vastUrl: "https://cdn.example.com/vast.xml" },
      slotId: "slot_video",
    });

    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.muted).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.playsInline).toBe(true);
  });

  it("calls AdsLoader.requestAds with the bid's vastUrl", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const ima = makeImaStub();

    const renderer = new VideoRenderer(
      ima as unknown as ConstructorParameters<typeof VideoRenderer>[0],
      callbacks,
    );
    renderer.render({
      container,
      bid: { adId: "bid_v2", vastUrl: "https://cdn.example.com/vast.xml" },
      slotId: "slot_v2",
    });

    const loader = ima.lastAdsLoader!;
    expect(loader.requestAds).toHaveBeenCalledTimes(1);
    const reqArg = loader.requestAds.mock.calls[0]?.[0] as { adTagUrl?: string };
    expect(reqArg.adTagUrl).toBe("https://cdn.example.com/vast.xml");
  });

  it("bridges IMA STARTED event to adRenderSuccess lifecycle event", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const seen: unknown[] = [];
    callbacks.on("adRenderSuccess", (p) => seen.push(p));

    const ima = makeImaStub();
    const renderer = new VideoRenderer(
      ima as unknown as ConstructorParameters<typeof VideoRenderer>[0],
      callbacks,
    );
    renderer.render({
      container,
      bid: { adId: "bid_v3", vastUrl: "https://cdn.example.com/vast.xml" },
      slotId: "slot_v3",
    });

    const loader = ima.lastAdsLoader!;
    // Simulate AdsManagerLoaded event with synthetic adsManager.
    const startCbs: Array<(e: unknown) => void> = [];
    const adsManager = {
      addEventListener: (type: string, cb: (e: unknown) => void) => {
        if (type === "start") startCbs.push(cb);
      },
      init: jest.fn(),
      start: jest.fn(),
    };
    const adsManagerLoadedCb = loader.addEventListener.mock.calls.find(
      (c) => c[0] === "adsManagerLoaded",
    )?.[1] as (e: unknown) => void;
    expect(adsManagerLoadedCb).toBeDefined();
    adsManagerLoadedCb({ getAdsManager: () => adsManager });

    // Fire IMA STARTED.
    for (const cb of startCbs) cb({});

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ slotId: "slot_v3", adId: "bid_v3" });
  });
});
