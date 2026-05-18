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

function makePbjs(): PbjsStub {
  return {
    que: [],
    setConfig: jest.fn(),
    addAdUnits: jest.fn(),
    removeAdUnit: jest.fn(),
    requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler({})),
    getHighestCpmBids: jest.fn().mockReturnValue([]),
    renderAd: jest.fn(),
  };
}

function makeImaStub(): ImaGlobal {
  return {
    AdsLoader: function () {} as unknown,
    AdDisplayContainer: function () {} as unknown as ImaGlobal["AdDisplayContainer"],
    AdsRequest: function () {} as unknown as ImaGlobal["AdsRequest"],
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

function appendScript(slotId: string): HTMLScriptElement {
  const s = document.createElement("script");
  s.id = slotId;
  document.body.appendChild(s);
  return s;
}

describe("bootstrap — per-slot IMA gate + pre-auction strip (D46 + D47)", () => {
  let pbjs: PbjsStub;

  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    delete (window as { google?: unknown }).google;
    delete (window as { AdWrapperConfig?: unknown }).AdWrapperConfig;
    jest.useFakeTimers();
    installIntersectionObserverStub();
    pbjs = makePbjs();
  });
  afterEach(() => {
    jest.useRealTimers();
    uninstallIntersectionObserverStub();
    delete (window as { AdWrapper?: unknown }).AdWrapper;
    delete (window as { google?: unknown }).google;
    delete (window as { AdWrapperConfig?: unknown }).AdWrapperConfig;
  });

  it("mixed slot + IMA loads OK → emits both banner and video mediaTypes", async () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_mixed_ok: {
        mediaTypes: {
          banner: { sizes: [[300, 250]] },
          video: { context: "instream", playerSize: [640, 480], mimes: ["video/mp4"] },
        },
        bidders: [{ bidder: "pubmatic", params: {} }],
        eager: true,
      },
    };
    const script = appendScript("slot_mixed_ok");

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      imaLoaderOverride: () => Promise.resolve(makeImaStub()),
      consentDisabled: true,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const units = pbjs.addAdUnits.mock.calls[0]?.[0] as Array<{
      mediaTypes: Record<string, unknown>;
    }>;
    expect(units).toHaveLength(1);
    expect(units[0]!.mediaTypes).toHaveProperty("banner");
    expect(units[0]!.mediaTypes).toHaveProperty("video");
  });

  it("mixed slot + IMA load fails → video stripped pre-auction, banner survives", async () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_mixed_fail: {
        mediaTypes: {
          banner: { sizes: [[300, 250]] },
          video: { context: "instream", playerSize: [640, 480], mimes: ["video/mp4"] },
        },
        bidders: [{ bidder: "pubmatic", params: {} }],
        eager: true,
      },
    };
    const script = appendScript("slot_mixed_fail");

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      imaLoaderOverride: () => Promise.reject(new Error("ima blocked")),
      consentDisabled: true,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    expect(pbjs.addAdUnits).toHaveBeenCalledTimes(1);
    const units = pbjs.addAdUnits.mock.calls[0]?.[0] as Array<{
      mediaTypes: Record<string, unknown>;
    }>;
    expect(units[0]!.mediaTypes).toHaveProperty("banner");
    expect(units[0]!.mediaTypes).not.toHaveProperty("video");
  });

  it("banner-only slot does NOT await IMA — auction proceeds without IMA promise resolving", async () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_banner_only: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "pubmatic", params: {} }],
        eager: true,
      },
    };
    const script = appendScript("slot_banner_only");

    // IMA loader returns a promise that never resolves. Banner-only slot must not block on it.
    const imaLoader = jest.fn().mockReturnValue(new Promise<ImaGlobal>(() => {}));

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      imaLoaderOverride: imaLoader,
      consentDisabled: true,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    expect(pbjs.addAdUnits).toHaveBeenCalledTimes(1);
    expect(imaLoader).not.toHaveBeenCalled();
  });

  it("emits `error` event with E_IMA_LOAD_FAIL when IMA loader rejects", async () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_err: {
        mediaTypes: {
          banner: { sizes: [[300, 250]] },
          video: { context: "instream", playerSize: [640, 480], mimes: ["video/mp4"] },
        },
        bidders: [{ bidder: "pubmatic", params: {} }],
        eager: true,
      },
    };
    const script = appendScript("slot_err");

    const errors: Array<{ code: string; message?: string }> = [];

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      imaLoaderOverride: () => Promise.reject(new Error("net blocked")),
      consentDisabled: true,
    });
    api.on("error", (p) => errors.push(p as { code: string; message?: string }));

    const reg = api.registerScript(script);
    await flush();
    await reg;

    expect(errors.some((e) => e.code === "E_IMA_LOAD_FAIL")).toBe(true);
  });

  it("video-bid would not be requested after strip — adUnit has no video block", async () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_strip: {
        mediaTypes: {
          banner: { sizes: [[300, 250]] },
          video: { context: "instream", playerSize: [640, 480], mimes: ["video/mp4"] },
        },
        bidders: [{ bidder: "pubmatic", params: {} }],
        eager: true,
      },
    };
    const script = appendScript("slot_strip");

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      imaLoaderOverride: () => Promise.reject(new Error("ima fail")),
      consentDisabled: true,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const units = pbjs.addAdUnits.mock.calls[0]?.[0] as Array<{
      mediaTypes: Record<string, unknown>;
    }>;
    const bannerSizes = (units[0]!.mediaTypes["banner"] as { sizes: number[][] }).sizes;
    expect(bannerSizes).toEqual([[300, 250]]);
    expect(Object.keys(units[0]!.mediaTypes)).toEqual(["banner"]);
  });
});
