import { bootstrap } from "../src/core/bootstrap";
import {
  installIntersectionObserverStub,
  uninstallIntersectionObserverStub,
} from "./helpers/iox-stub";

interface PbjsStub {
  que: Array<() => void>;
  setConfig: jest.Mock;
  addAdUnits: jest.Mock;
  requestBids: jest.Mock<
    void,
    [{ adUnitCodes: string[]; bidsBackHandler: (bids: unknown) => void }]
  >;
  getHighestCpmBids: jest.Mock<Array<{ adId: string; width: number; height: number }>, [string]>;
  renderAd: jest.Mock<void, [Document, string]>;
}

describe("Issue #1 tracer: single banner happy path", () => {
  let pbjs: PbjsStub;

  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    jest.useFakeTimers();
    installIntersectionObserverStub();

    pbjs = {
      que: [],
      setConfig: jest.fn(),
      addAdUnits: jest.fn(),
      requestBids: jest.fn(({ bidsBackHandler }) => {
        bidsBackHandler({
          /* unused */
        });
      }),
      getHighestCpmBids: jest
        .fn()
        .mockReturnValue([{ adId: "winning_bid_1", width: 300, height: 250, cpm: 1.5 }]),
      renderAd: jest.fn(),
    };

    (window as unknown as { pbjs?: PbjsStub }).pbjs = pbjs;
  });

  afterEach(() => {
    jest.useRealTimers();
    uninstallIntersectionObserverStub();
    delete (window as { AdWrapper?: unknown }).AdWrapper;
  });

  it("registers a banner slot via window.AdWrapperConfig + script tag and renders the winning bid", async () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      homepage_300x250_top: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
        eager: true,
      },
    };

    const wrapper = document.createElement("section");
    const script = document.createElement("script");
    script.id = "homepage_300x250_top";
    wrapper.appendChild(script);
    document.body.appendChild(wrapper);

    const events: Array<{ event: string; payload: unknown }> = [];
    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () =>
        Promise.resolve(pbjs as unknown as import("../src/core/dependency-loader").PrebidGlobal),
      consentDisabled: true,
    });
    api.on("adRenderSuccess", (p) => events.push({ event: "adRenderSuccess", payload: p }));

    const reg = api.registerScript(script);
    // Allow the awaited prebid loader + start() Promise.all to settle, then advance debounce.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(50);
    await reg;

    const container = wrapper.querySelector("[data-adwrapper-slot]") as HTMLDivElement;
    expect(container).not.toBeNull();
    expect(container.style.width).toBe("300px");
    expect(container.style.height).toBe("250px");

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();

    expect(pbjs.renderAd).toHaveBeenCalledWith(iframe!.contentDocument, "winning_bid_1");
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe("adRenderSuccess");
  });
});
