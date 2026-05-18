import { bootstrap } from "../src/core/bootstrap";
import type { PrebidGlobal } from "../src/core/dependency-loader";
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
    getHighestCpmBids: jest.fn().mockReturnValue([{ adId: "x", width: 300, height: 250, cpm: 1 }]),
    renderAd: jest.fn(),
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  jest.advanceTimersByTime(50);
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe("bootstrap — prebidConfig passthrough", () => {
  let pbjs: PbjsStub;

  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    jest.useFakeTimers();
    installIntersectionObserverStub();
    pbjs = makePbjs();
  });
  afterEach(() => {
    jest.useRealTimers();
    uninstallIntersectionObserverStub();
    delete (window as { AdWrapper?: unknown }).AdWrapper;
  });

  it("forwards verbatim prebidConfig object to pbjs.setConfig after Prebid loads", async () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_pc: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: {} }],
        eager: true,
      },
    };
    const script = document.createElement("script");
    script.id = "slot_pc";
    document.body.appendChild(script);

    const prebidConfig = {
      bidderTimeout: 1500,
      priceGranularity: "dense",
      cache: { url: "https://prebid.adnxs.com/pbc/v1/cache" },
    };

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
      prebidConfig,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const calls = pbjs.setConfig.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual(prebidConfig);
  });

  it("omits prebidConfig setConfig call when option is absent", async () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_pc_off: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: {} }],
        eager: true,
      },
    };
    const script = document.createElement("script");
    script.id = "slot_pc_off";
    document.body.appendChild(script);

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const calls = pbjs.setConfig.mock.calls.map((c) => c[0]) as Array<Record<string, unknown>>;
    expect(calls.some((c) => "bidderTimeout" in c || "priceGranularity" in c)).toBe(false);
  });

  it("ignores empty prebidConfig object (no setConfig call for it)", async () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_pc_empty: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: {} }],
        eager: true,
      },
    };
    const script = document.createElement("script");
    script.id = "slot_pc_empty";
    document.body.appendChild(script);

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
      prebidConfig: {},
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const calls = pbjs.setConfig.mock.calls.map((c) => c[0]) as Array<Record<string, unknown>>;
    // No setConfig invocation should equal the empty prebidConfig object literally.
    // (Identity-driven userSync call may still happen — assert only that an empty `{}` config is not pushed.)
    expect(calls.some((c) => Object.keys(c).length === 0)).toBe(false);
  });
});
