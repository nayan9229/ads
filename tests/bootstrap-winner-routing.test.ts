import { bootstrap } from "../src/core/bootstrap";
import type { PrebidGlobal, ImaGlobal } from "../src/core/dependency-loader";
import {
  installIntersectionObserverStub,
  uninstallIntersectionObserverStub,
} from "./helpers/iox-stub";

interface PbjsStub {
  que: Array<() => void>;
  setConfig: jest.Mock;
  addAdUnits: jest.Mock;
  removeAdUnit: jest.Mock;
  requestBids: jest.Mock;
  getHighestCpmBids: jest.Mock;
  renderAd: jest.Mock;
}

function makePbjs(winners: Array<Record<string, unknown>>): PbjsStub {
  return {
    que: [],
    setConfig: jest.fn(),
    addAdUnits: jest.fn(),
    removeAdUnit: jest.fn(),
    requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler({})),
    getHighestCpmBids: jest.fn().mockReturnValue(winners),
    renderAd: jest.fn(),
  };
}

function makeImaStub(): ImaGlobal {
  // Minimal IMA stub: AdsLoader stores listener but never fires it (test exits
  // before async flow). VideoRenderer's observable DOM side effect (<video> +
  // adContainer appended to slot container) is what we assert on.
  return {
    AdsLoader: function () {
      return {
        requestAds: (): void => {},
        addEventListener: (): void => {},
        contentComplete: (): void => {},
      };
    } as unknown as ImaGlobal["AdsLoader"],
    AdDisplayContainer: function () {
      return { initialize: (): void => {} };
    } as unknown as ImaGlobal["AdDisplayContainer"],
    AdsRequest: function () {
      return {};
    } as unknown as ImaGlobal["AdsRequest"],
    AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: "X" } },
    AdEvent: { Type: {} },
    AdErrorEvent: { Type: { AD_ERROR: "X" } },
  } as unknown as ImaGlobal;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  jest.advanceTimersByTime(50);
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function registerMixedSlot(slotId: string): HTMLScriptElement {
  (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
    [slotId]: {
      mediaTypes: {
        banner: { sizes: [[300, 250]] },
        video: { context: "instream", playerSize: [640, 480], mimes: ["video/mp4"] },
      },
      bidders: [{ bidder: "pubmatic", params: {} }],
      eager: true,
    },
  };
  const s = document.createElement("script");
  s.id = slotId;
  document.body.appendChild(s);
  return s;
}

function getSlotContainer(slotId: string): HTMLElement | null {
  return document.querySelector(`[data-adwrapper-slot="${slotId}"]`);
}

describe("bootstrap — mixed-media winner routing by bid.mediaType", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    delete (window as { google?: unknown }).google;
    delete (window as { AdWrapperConfig?: unknown }).AdWrapperConfig;
    jest.useFakeTimers();
    installIntersectionObserverStub();
  });
  afterEach(() => {
    jest.useRealTimers();
    uninstallIntersectionObserverStub();
    delete (window as { AdWrapper?: unknown }).AdWrapper;
    delete (window as { google?: unknown }).google;
    delete (window as { AdWrapperConfig?: unknown }).AdWrapperConfig;
  });

  it("video winner → VideoRenderer (container gets <video> element)", async () => {
    const script = registerMixedSlot("slot_v_wins");
    const pbjs = makePbjs([
      {
        adId: "vid1",
        mediaType: "video",
        vastUrl: "https://example.com/v.xml",
        width: 640,
        height: 480,
        cpm: 5,
        currency: "USD",
      },
    ]);

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      imaLoaderOverride: () => Promise.resolve(makeImaStub()),
      consentDisabled: true,
    });
    const reg = api.registerScript(script);
    await flush();
    await reg;

    const container = getSlotContainer("slot_v_wins")!;
    expect(container.querySelector("video")).not.toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("banner winner → BannerRenderer (container gets <iframe>)", async () => {
    const script = registerMixedSlot("slot_b_wins");
    const pbjs = makePbjs([
      {
        adId: "ban1",
        mediaType: "banner",
        width: 300,
        height: 250,
        cpm: 3,
        currency: "USD",
      },
    ]);

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      imaLoaderOverride: () => Promise.resolve(makeImaStub()),
      consentDisabled: true,
    });
    const reg = api.registerScript(script);
    await flush();
    await reg;

    const container = getSlotContainer("slot_b_wins")!;
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(container.querySelector("video")).toBeNull();
  });

  it("winner without mediaType defaults to banner path", async () => {
    const script = registerMixedSlot("slot_default");
    const pbjs = makePbjs([
      {
        adId: "x1",
        width: 300,
        height: 250,
        cpm: 2,
        currency: "USD",
      },
    ]);

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      imaLoaderOverride: () => Promise.resolve(makeImaStub()),
      consentDisabled: true,
    });
    const reg = api.registerScript(script);
    await flush();
    await reg;

    const container = getSlotContainer("slot_default")!;
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(container.querySelector("video")).toBeNull();
  });

  it("video winner emits adRenderSuccess (banner path equivalent — fires immediately via callbacks)", async () => {
    const script = registerMixedSlot("slot_b_evt");
    const pbjs = makePbjs([
      { adId: "ban1", mediaType: "banner", width: 300, height: 250, cpm: 4, currency: "USD" },
    ]);

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      imaLoaderOverride: () => Promise.resolve(makeImaStub()),
      consentDisabled: true,
    });
    const events: Array<{ slotId: string }> = [];
    api.on("adRenderSuccess", (p) => events.push(p as { slotId: string }));

    const reg = api.registerScript(script);
    await flush();
    await reg;

    expect(events.some((e) => e.slotId === "slot_b_evt")).toBe(true);
  });
});
