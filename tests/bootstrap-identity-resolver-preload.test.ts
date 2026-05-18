import { bootstrap } from "../src/core/bootstrap";
import type { PrebidGlobal, IdentityResolverGlobal } from "../src/core/dependency-loader";
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

function makeResolverStub(): IdentityResolverGlobal {
  return {
    resolveIdentitySignals: () => ({ eids: [], buyeruid: undefined }),
  } as unknown as IdentityResolverGlobal;
}

describe("bootstrap — identityResolver config-sniff parallel preload", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    delete (window as { AdWrapperConfig?: unknown }).AdWrapperConfig;
    jest.useFakeTimers();
    installIntersectionObserverStub();
  });
  afterEach(() => {
    jest.useRealTimers();
    uninstallIntersectionObserverStub();
    delete (window as { AdWrapper?: unknown }).AdWrapper;
    delete (window as { AdWrapperConfig?: unknown }).AdWrapperConfig;
  });

  it("does NOT invoke identityResolver loader when identityResolver is absent from options", () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_a: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "pubmatic", params: {} }],
      },
    };
    const identityLoader = jest.fn().mockResolvedValue(makeResolverStub());
    const pbjs = makePbjs();

    bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      identityResolverLoaderOverride: identityLoader,
      consentDisabled: true,
    });

    expect(identityLoader).not.toHaveBeenCalled();
  });

  it("emits an `error` event with E_IDENTITY_LOAD_FAIL exactly once when the loader rejects", async () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_err: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "pubmatic", params: {} }],
      },
    };
    const identityLoader = jest.fn().mockRejectedValue(new Error("network blocked"));
    const pbjs = makePbjs();

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      identityResolverLoaderOverride: identityLoader,
      identityResolver: { enabled: true },
      consentDisabled: true,
    });

    const errors: Array<{ code: string }> = [];
    api.on("error", (p) => errors.push(p as { code: string }));

    // Let microtasks drain so the rejection chain hits the .catch + emit.
    for (let i = 0; i < 6; i++) await Promise.resolve();

    const identityErrors = errors.filter((e) => e.code === "E_IDENTITY_LOAD_FAIL");
    expect(identityErrors).toHaveLength(1);
  });

  it("invokes identityResolver loader exactly once even with multiple slots configured", () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_m1: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "pubmatic", params: {} }],
      },
      slot_m2: {
        mediaTypes: { banner: { sizes: [[300, 600]] } },
        bidders: [{ bidder: "pubmatic", params: {} }],
      },
      slot_m3: {
        mediaTypes: { banner: { sizes: [[728, 90]] } },
        bidders: [{ bidder: "pubmatic", params: {} }],
      },
    };
    const identityLoader = jest.fn().mockResolvedValue(makeResolverStub());
    const pbjs = makePbjs();

    bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      identityResolverLoaderOverride: identityLoader,
      identityResolver: { enabled: true },
      consentDisabled: true,
    });

    expect(identityLoader).toHaveBeenCalledTimes(1);
  });

  it("does NOT invoke identityResolver loader in webview environment even with enabled:true", () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_wv: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "pubmatic", params: {} }],
      },
    };
    const identityLoader = jest.fn().mockResolvedValue(makeResolverStub());
    const pbjs = makePbjs();

    bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      identityResolverLoaderOverride: identityLoader,
      identityResolver: { enabled: true },
      environment: "webview",
      consentDisabled: true,
    });

    expect(identityLoader).not.toHaveBeenCalled();
  });

  it("invokes identityResolver loader exactly once when enabled and a slot is configured", () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_e: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "pubmatic", params: {} }],
      },
    };
    const identityLoader = jest.fn().mockResolvedValue(makeResolverStub());
    const pbjs = makePbjs();

    bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      identityResolverLoaderOverride: identityLoader,
      identityResolver: { enabled: true },
      consentDisabled: true,
    });

    expect(identityLoader).toHaveBeenCalledTimes(1);
  });

  it("does NOT invoke identityResolver loader when identityResolver.enabled is false", () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_b: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "pubmatic", params: {} }],
      },
    };
    const identityLoader = jest.fn().mockResolvedValue(makeResolverStub());
    const pbjs = makePbjs();

    bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      identityResolverLoaderOverride: identityLoader,
      identityResolver: { enabled: false },
      consentDisabled: true,
    });

    expect(identityLoader).not.toHaveBeenCalled();
  });
});
