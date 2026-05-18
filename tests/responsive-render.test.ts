import { bootstrap } from "../src/core/bootstrap";
import type { PrebidGlobal } from "../src/core/dependency-loader";
import { DomInjector } from "../src/dom/dom-injector";
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

function makeBootstrapPbjs(winner: { adId: string; width: number; height: number }): PbjsStub {
  return {
    que: [],
    setConfig: jest.fn(),
    addAdUnits: jest.fn(),
    removeAdUnit: jest.fn(),
    requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler({})),
    getHighestCpmBids: jest.fn().mockReturnValue([{ ...winner, cpm: 1 }]),
    renderAd: jest.fn(),
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  jest.advanceTimersByTime(50);
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function setViewport(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

describe("Responsive banner sizing", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    jest.useFakeTimers();
    installIntersectionObserverStub();
  });
  afterEach(() => {
    jest.useRealTimers();
    uninstallIntersectionObserverStub();
    delete (window as { AdWrapper?: unknown }).AdWrapper;
  });

  it("DomInjector reserves the largest size in the resolved breakpoint", () => {
    const injector = new DomInjector();
    const script = document.createElement("script");
    script.id = "slot_reserve";
    document.body.appendChild(script);

    // Resolved breakpoint [[728,90],[300,250]] → largest width 728, largest height 250.
    const container = injector.inject({
      scriptEl: script,
      slotId: "slot_reserve",
      reserved: [728, 250],
    });

    expect(container.style.width).toBe("728px");
    expect(container.style.height).toBe("250px");
  });

  it("bootstrap reserves the largest size in the resolved breakpoint set", async () => {
    setViewport(1024);
    const pbjs = makeBootstrapPbjs({ adId: "bid_x", width: 728, height: 90 });

    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_resp: {
        mediaTypes: {
          banner: {
            sizes: {
              "0-767": [[300, 250]],
              "768-1199": [
                [728, 90],
                [300, 250],
              ],
              "1200+": [[970, 250]],
            },
          },
        },
        bidders: [{ bidder: "appnexus", params: {} }],
        eager: true,
      },
    };

    const script = document.createElement("script");
    script.id = "slot_resp";
    document.body.appendChild(script);

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const container = document.querySelector('[data-adwrapper-slot="slot_resp"]') as HTMLDivElement;
    expect(container.style.width).toBe("728px");
    expect(container.style.height).toBe("250px");
  });

  it("smaller winning bid renders at bid size; container keeps reserved dimensions", async () => {
    setViewport(1024);
    // Winner is 300x250 but reserved at 728x250 from breakpoint.
    const pbjs = makeBootstrapPbjs({ adId: "bid_small", width: 300, height: 250 });

    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_small: {
        mediaTypes: {
          banner: {
            sizes: {
              "768-1199": [
                [728, 90],
                [300, 250],
              ],
            },
          },
        },
        bidders: [{ bidder: "appnexus", params: {} }],
        eager: true,
      },
    };

    const script = document.createElement("script");
    script.id = "slot_small";
    document.body.appendChild(script);

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const container = document.querySelector(
      '[data-adwrapper-slot="slot_small"]',
    ) as HTMLDivElement;
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;

    expect(container.style.width).toBe("728px");
    expect(container.style.height).toBe("250px");
    expect(iframe.width).toBe("300");
    expect(iframe.height).toBe("250");
  });

  it("shrinkToAdSize:true collapses container to bid size after render", async () => {
    setViewport(1024);
    const pbjs = makeBootstrapPbjs({ adId: "bid_shrink", width: 300, height: 250 });

    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_shrink: {
        mediaTypes: {
          banner: {
            sizes: {
              "768-1199": [
                [728, 90],
                [300, 250],
              ],
            },
            shrinkToAdSize: true,
          },
        },
        bidders: [{ bidder: "appnexus", params: {} }],
        eager: true,
      },
    };

    const script = document.createElement("script");
    script.id = "slot_shrink";
    document.body.appendChild(script);

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const container = document.querySelector(
      '[data-adwrapper-slot="slot_shrink"]',
    ) as HTMLDivElement;
    expect(container.style.width).toBe("300px");
    expect(container.style.height).toBe("250px");
  });
});
