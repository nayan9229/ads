import { bootstrap } from "../src/core/bootstrap";
import * as detectEnv from "../src/core/detect-environment";
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

// P3 (D65): identity is disabled in a cross-origin safeframe (unusable cookies),
// mirroring the webview degradation (D34). jsdom is always `top`, so we force the
// surface via a spy on detectSurface.
describe("bootstrap — safeframe degradation (P3/D65)", () => {
  let surfaceSpy: jest.SpyInstance;
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    delete (window as { AdWrapperConfig?: unknown }).AdWrapperConfig;
    jest.useFakeTimers();
    installIntersectionObserverStub();
    surfaceSpy = jest.spyOn(detectEnv, "detectSurface").mockReturnValue("safeframe");
  });
  afterEach(() => {
    jest.useRealTimers();
    uninstallIntersectionObserverStub();
    surfaceSpy.mockRestore();
    delete (window as { AdWrapper?: unknown }).AdWrapper;
    delete (window as { AdWrapperConfig?: unknown }).AdWrapperConfig;
  });

  it("does NOT invoke the identityResolver loader in a safeframe even with enabled:true", () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_sf: {
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

    expect(identityLoader).not.toHaveBeenCalled();
  });

  it("emits environment_detected with surface 'safeframe'", () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_sf2: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "pubmatic", params: {} }],
      },
    };
    const pbjs = makePbjs();
    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
    });
    const seen: Array<{ surface?: string }> = [];
    api.on("environment_detected", (p) => seen.push(p as { surface?: string }));

    return Promise.resolve().then(() => {
      expect(seen[0]?.surface).toBe("safeframe");
    });
  });
});
