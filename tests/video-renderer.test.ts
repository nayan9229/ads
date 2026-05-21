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
    Type: { STARTED: "start"; COMPLETE: "complete"; SKIPPED: "skip"; AD_PROGRESS: "adProgress" };
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
    AdEvent: { Type: { STARTED: "start", COMPLETE: "complete", SKIPPED: "skip", AD_PROGRESS: "adProgress" } },
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

  it("emits adComplete with { slotId, mediaType: 'video' } on IMA COMPLETE", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const seen: unknown[] = [];
    callbacks.on("adComplete", (p) => seen.push(p));

    const ima = makeImaStub();
    const renderer = new VideoRenderer(
      ima as unknown as ConstructorParameters<typeof VideoRenderer>[0],
      callbacks,
    );
    renderer.render({
      container,
      bid: { adId: "bid_ac", vastUrl: "https://cdn.example.com/vast.xml" },
      slotId: "slot_ac_video",
    });

    const loader = ima.lastAdsLoader!;
    const completeCbs: Array<(e: unknown) => void> = [];
    const adsManager = {
      addEventListener: (type: string, cb: (e: unknown) => void) => {
        if (type === "complete") completeCbs.push(cb);
      },
      init: jest.fn(),
      start: jest.fn(),
    };
    const adsManagerLoadedCb = loader.addEventListener.mock.calls.find(
      (c) => c[0] === "adsManagerLoaded",
    )?.[1] as (e: unknown) => void;
    adsManagerLoadedCb({ getAdsManager: () => adsManager });

    for (const cb of completeCbs) cb({});

    expect(seen).toEqual([{ slotId: "slot_ac_video", mediaType: "video" }]);
  });

  it("emits both viewable and adComplete on IMA COMPLETE", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const events: Array<{ event: string; payload: unknown }> = [];
    callbacks.on("viewable",   (p) => events.push({ event: "viewable",   payload: p }));
    callbacks.on("adComplete", (p) => events.push({ event: "adComplete", payload: p }));

    const ima = makeImaStub();
    const renderer = new VideoRenderer(
      ima as unknown as ConstructorParameters<typeof VideoRenderer>[0],
      callbacks,
    );
    renderer.render({
      container,
      bid: { adId: "bid_both", vastUrl: "https://cdn.example.com/vast.xml" },
      slotId: "slot_both",
    });

    const loader = ima.lastAdsLoader!;
    const completeCbs: Array<(e: unknown) => void> = [];
    const adsManager = {
      addEventListener: (type: string, cb: (e: unknown) => void) => {
        if (type === "complete") completeCbs.push(cb);
      },
      init: jest.fn(),
      start: jest.fn(),
    };
    const adsManagerLoadedCb = loader.addEventListener.mock.calls.find(
      (c) => c[0] === "adsManagerLoaded",
    )?.[1] as (e: unknown) => void;
    adsManagerLoadedCb({ getAdsManager: () => adsManager });

    for (const cb of completeCbs) cb({});

    expect(events.map((e) => e.event)).toEqual(["viewable", "adComplete"]);
  });

  it("does not emit adComplete on IMA AD_ERROR", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const seen: unknown[] = [];
    callbacks.on("adComplete", (p) => seen.push(p));

    const ima = makeImaStub();
    const renderer = new VideoRenderer(
      ima as unknown as ConstructorParameters<typeof VideoRenderer>[0],
      callbacks,
    );
    renderer.render({
      container,
      bid: { adId: "bid_err", vastUrl: "https://cdn.example.com/vast.xml" },
      slotId: "slot_err",
    });

    const loader = ima.lastAdsLoader!;
    const adErrorCb = loader.addEventListener.mock.calls.find(
      (c) => c[0] === "adError",
    )?.[1] as (e: unknown) => void;
    adErrorCb({ getError: () => ({ getMessage: () => "network error" }) });

    expect(seen).toHaveLength(0);
  });

  it("emits adSkipped with { slotId, mediaType: 'video' } on IMA SKIPPED", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const seen: unknown[] = [];
    callbacks.on("adSkipped", (p) => seen.push(p));

    const ima = makeImaStub();
    const renderer = new VideoRenderer(
      ima as unknown as ConstructorParameters<typeof VideoRenderer>[0],
      callbacks,
    );
    renderer.render({
      container,
      bid: { adId: "bid_sk", vastUrl: "https://cdn.example.com/vast.xml" },
      slotId: "slot_sk",
    });

    const loader = ima.lastAdsLoader!;
    const skipCbs: Array<(e: unknown) => void> = [];
    const adsManager = {
      addEventListener: (type: string, cb: (e: unknown) => void) => {
        if (type === "skip") skipCbs.push(cb);
      },
      init: jest.fn(),
      start: jest.fn(),
    };
    const adsManagerLoadedCb = loader.addEventListener.mock.calls.find(
      (c) => c[0] === "adsManagerLoaded",
    )?.[1] as (e: unknown) => void;
    adsManagerLoadedCb({ getAdsManager: () => adsManager });

    for (const cb of skipCbs) cb({});

    expect(seen).toEqual([{ slotId: "slot_sk", mediaType: "video" }]);
  });

  it("does not emit viewable or adComplete on IMA SKIPPED", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const unexpected: string[] = [];
    callbacks.on("viewable",   () => unexpected.push("viewable"));
    callbacks.on("adComplete", () => unexpected.push("adComplete"));

    const ima = makeImaStub();
    const renderer = new VideoRenderer(
      ima as unknown as ConstructorParameters<typeof VideoRenderer>[0],
      callbacks,
    );
    renderer.render({
      container,
      bid: { adId: "bid_sk2", vastUrl: "https://cdn.example.com/vast.xml" },
      slotId: "slot_sk2",
    });

    const loader = ima.lastAdsLoader!;
    const skipCbs: Array<(e: unknown) => void> = [];
    const adsManager = {
      addEventListener: (type: string, cb: (e: unknown) => void) => {
        if (type === "skip") skipCbs.push(cb);
      },
      init: jest.fn(),
      start: jest.fn(),
    };
    const adsManagerLoadedCb = loader.addEventListener.mock.calls.find(
      (c) => c[0] === "adsManagerLoaded",
    )?.[1] as (e: unknown) => void;
    adsManagerLoadedCb({ getAdsManager: () => adsManager });

    for (const cb of skipCbs) cb({});

    expect(unexpected).toHaveLength(0);
  });

  it("adSkipped and adComplete are independent — COMPLETE does not emit adSkipped", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const skipped: unknown[] = [];
    callbacks.on("adSkipped", (p) => skipped.push(p));

    const ima = makeImaStub();
    const renderer = new VideoRenderer(
      ima as unknown as ConstructorParameters<typeof VideoRenderer>[0],
      callbacks,
    );
    renderer.render({
      container,
      bid: { adId: "bid_ind", vastUrl: "https://cdn.example.com/vast.xml" },
      slotId: "slot_ind",
    });

    const loader = ima.lastAdsLoader!;
    const completeCbs: Array<(e: unknown) => void> = [];
    const adsManager = {
      addEventListener: (type: string, cb: (e: unknown) => void) => {
        if (type === "complete") completeCbs.push(cb);
      },
      init: jest.fn(),
      start: jest.fn(),
    };
    const adsManagerLoadedCb = loader.addEventListener.mock.calls.find(
      (c) => c[0] === "adsManagerLoaded",
    )?.[1] as (e: unknown) => void;
    adsManagerLoadedCb({ getAdsManager: () => adsManager });

    for (const cb of completeCbs) cb({});

    expect(skipped).toHaveLength(0);
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
