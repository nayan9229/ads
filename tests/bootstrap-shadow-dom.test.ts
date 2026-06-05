import { bootstrap } from "../src/core/bootstrap";
import {
  installIntersectionObserverStub,
  uninstallIntersectionObserverStub,
} from "./helpers/iox-stub";

interface PbjsStub {
  que: Array<() => void>;
  setConfig: jest.Mock;
  addAdUnits: jest.Mock;
  removeAdUnit: jest.Mock;
  requestBids: jest.Mock<
    void,
    [{ adUnitCodes: string[]; bidsBackHandler: (bids: unknown) => void }]
  >;
  getHighestCpmBids: jest.Mock;
  renderAd: jest.Mock<void, [Document, string]>;
}

function makePbjs(): PbjsStub {
  return {
    que: [],
    setConfig: jest.fn(),
    addAdUnits: jest.fn(),
    removeAdUnit: jest.fn(),
    requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler({})),
    getHighestCpmBids: jest
      .fn()
      .mockReturnValue([{ adId: "bid_x", width: 300, height: 250, cpm: 1 }]),
    renderAd: jest.fn(),
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  jest.advanceTimersByTime(50);
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function makeApi(pbjs: PbjsStub): ReturnType<typeof bootstrap> {
  return bootstrap({
    prebidSrc: "https://example.com/prebid.js",
    prebidLoaderOverride: () =>
      Promise.resolve(pbjs as unknown as import("../src/core/dependency-loader").PrebidGlobal),
    consentDisabled: true,
  });
}

// Builds an open shadow root on a fresh host and returns the container element living
// inside it. Mirrors a framework mount hook that attaches shadow DOM after page load.
function mountShadowContainer(containerId: string): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  const container = document.createElement("div");
  container.id = containerId;
  root.appendChild(container);
  return container;
}

describe("bootstrap — Shadow-DOM slot registration (D60)", () => {
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
    delete (window as { AdWrapperConfig?: unknown }).AdWrapperConfig;
  });

  it("renders into a shadow-rooted container passed via registerSlot", async () => {
    const container = mountShadowContainer("shadow-ad-box");

    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      shadow_slot: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
        eager: true,
      },
    };

    const api = makeApi(pbjs);
    await api.registerSlot("shadow_slot", container);
    await flush();

    // Container is marked and used directly — no ID lookup, no traversal.
    expect(container.dataset.adwrapperSlot).toBe("shadow_slot");
    // It really lives inside a shadow root, invisible to document.getElementById.
    expect(document.getElementById("shadow-ad-box")).toBeNull();
    expect(pbjs.addAdUnits).toHaveBeenCalled();
  });

  it("uses the provided element directly without injecting a sibling div", async () => {
    const container = mountShadowContainer("no-sibling-box");

    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      no_sibling_slot: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
        eager: true,
      },
    };

    const api = makeApi(pbjs);
    await api.registerSlot("no_sibling_slot", container);
    await flush();

    // No SDK-injected sizing styles on a publisher-owned surface.
    expect(container.style.display).toBe("");
    expect(container.nextElementSibling).toBeNull();
  });

  it("throws ConfigError when no config exists for the slot", async () => {
    const container = mountShadowContainer("orphan-box");
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {};

    const api = makeApi(pbjs);
    await expect(api.registerSlot("missing_slot", container)).rejects.toThrow(/no config for slot/);
  });

  it("throws TypeError when containerEl is not an HTMLElement", async () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      bad_arg_slot: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
        eager: true,
      },
    };

    const api = makeApi(pbjs);
    await expect(
      api.registerSlot("bad_arg_slot", "shadow-ad-box" as unknown as HTMLElement),
    ).rejects.toThrow(TypeError);
  });

  it("destroy() clears the shadow-rooted container without removing it (D53 semantics)", async () => {
    const container = mountShadowContainer("persist-shadow-box");
    const root = container.parentNode as ShadowRoot;

    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      persist_slot: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
        eager: true,
      },
    };

    const api = makeApi(pbjs);
    await api.registerSlot("persist_slot", container);
    await flush();

    container.innerHTML = "<span>ad content</span>";
    api.destroy("persist_slot");

    // Element survives (SDK didn't create it); only its contents are cleared.
    expect(root.getElementById("persist-shadow-box")).toBe(container);
    expect(container.innerHTML).toBe("");
  });

  it("is idempotent on re-mount — re-registering the same slot tears down first", async () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      remount_slot: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
        eager: true,
      },
    };

    const api = makeApi(pbjs);

    const first = mountShadowContainer("remount-box-1");
    await api.registerSlot("remount_slot", first);
    await flush();
    expect(first.dataset.adwrapperSlot).toBe("remount_slot");

    const second = mountShadowContainer("remount-box-2");
    await api.registerSlot("remount_slot", second);
    await flush();

    // New surface is active; the first slot's adUnit was torn down (removeAdUnit called).
    expect(second.dataset.adwrapperSlot).toBe("remount_slot");
    expect(pbjs.removeAdUnit).toHaveBeenCalledWith("remount_slot");
  });
});
