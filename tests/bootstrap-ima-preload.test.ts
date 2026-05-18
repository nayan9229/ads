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
    AdsLoader: function () {} as unknown as ImaGlobal["AdsLoader"],
    AdDisplayContainer: function () {} as unknown as ImaGlobal["AdDisplayContainer"],
    AdsRequest: function () {} as unknown as ImaGlobal["AdsRequest"],
    AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: "ADS_MANAGER_LOADED" } },
    AdEvent: { Type: {} },
    AdErrorEvent: { Type: { AD_ERROR: "AD_ERROR" } },
  } as unknown as ImaGlobal;
}

describe("bootstrap — IMA conditional preload (D43)", () => {
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

  it("triggers IMA preload when a slot config declares mediaTypes.video (instream)", () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_v: {
        mediaTypes: {
          banner: { sizes: [[300, 250]] },
          video: { context: "instream", playerSize: [640, 480], mimes: ["video/mp4"] },
        },
        bidders: [{ bidder: "pubmatic", params: {} }],
      },
    };
    const imaLoader = jest.fn().mockResolvedValue(makeImaStub());
    const pbjs = makePbjs();

    bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      imaLoaderOverride: imaLoader,
      consentDisabled: true,
    });

    expect(imaLoader).toHaveBeenCalledTimes(1);
  });

  it("triggers IMA preload for outstream video as well (any context counts)", () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_out: {
        mediaTypes: {
          video: { context: "outstream", playerSize: [640, 480], mimes: ["video/mp4"] },
        },
        bidders: [{ bidder: "pubmatic", params: {} }],
      },
    };
    const imaLoader = jest.fn().mockResolvedValue(makeImaStub());
    const pbjs = makePbjs();

    bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      imaLoaderOverride: imaLoader,
      consentDisabled: true,
    });

    expect(imaLoader).toHaveBeenCalledTimes(1);
  });

  it("does NOT trigger IMA preload for banner-only configs", () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_b: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "pubmatic", params: {} }],
      },
    };
    const imaLoader = jest.fn().mockResolvedValue(makeImaStub());
    const pbjs = makePbjs();

    bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      imaLoaderOverride: imaLoader,
      consentDisabled: true,
    });

    expect(imaLoader).not.toHaveBeenCalled();
  });

  it("does NOT trigger IMA preload when AdWrapperConfig is absent", () => {
    const imaLoader = jest.fn().mockResolvedValue(makeImaStub());
    const pbjs = makePbjs();

    bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      imaLoaderOverride: imaLoader,
      consentDisabled: true,
    });

    expect(imaLoader).not.toHaveBeenCalled();
  });

  it("triggers IMA preload at most once even when multiple video slots are configured", () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_v1: {
        mediaTypes: {
          video: { context: "instream", playerSize: [640, 480], mimes: ["video/mp4"] },
        },
        bidders: [{ bidder: "pubmatic", params: {} }],
      },
      slot_v2: {
        mediaTypes: {
          video: { context: "outstream", playerSize: [640, 480], mimes: ["video/mp4"] },
        },
        bidders: [{ bidder: "pubmatic", params: {} }],
      },
    };
    const imaLoader = jest.fn().mockResolvedValue(makeImaStub());
    const pbjs = makePbjs();

    bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      imaLoaderOverride: imaLoader,
      consentDisabled: true,
    });

    expect(imaLoader).toHaveBeenCalledTimes(1);
  });
});
