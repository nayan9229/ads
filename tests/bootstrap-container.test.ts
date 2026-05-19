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

describe("bootstrap — explicit container (D53)", () => {
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

  it("renders inside the publisher-provided container when container ID resolves", async () => {
    const publisherDiv = document.createElement("div");
    publisherDiv.id = "my-ad-surface";
    document.body.appendChild(publisherDiv);

    const script = document.createElement("script");
    script.id = "slot_with_container";
    document.body.appendChild(script);

    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_with_container: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
        eager: true,
        container: "my-ad-surface",
      },
    };

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () =>
        Promise.resolve(pbjs as unknown as import("../src/core/dependency-loader").PrebidGlobal),
      consentDisabled: true,
    });

    await api.registerScript(script);
    await flush();

    expect(publisherDiv.dataset.adwrapperSlot).toBe("slot_with_container");
    expect(document.querySelector('[data-adwrapper-slot="slot_with_container"]')).toBe(publisherDiv);
  });

  it("does not inject a sibling div when a valid container ID is provided", async () => {
    const publisherDiv = document.createElement("div");
    publisherDiv.id = "explicit-container";
    document.body.appendChild(publisherDiv);

    const wrapper = document.createElement("section");
    const script = document.createElement("script");
    script.id = "slot_no_sibling";
    wrapper.appendChild(script);
    document.body.appendChild(wrapper);

    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_no_sibling: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
        eager: true,
        container: "explicit-container",
      },
    };

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () =>
        Promise.resolve(pbjs as unknown as import("../src/core/dependency-loader").PrebidGlobal),
      consentDisabled: true,
    });

    await api.registerScript(script);
    await flush();

    expect(script.nextElementSibling).toBeNull();
  });

  it("emits E_CONFIG_INVALID and falls back to sibling injection when container ID is not found", async () => {
    const wrapper = document.createElement("section");
    const script = document.createElement("script");
    script.id = "slot_missing_container";
    wrapper.appendChild(script);
    document.body.appendChild(wrapper);

    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_missing_container: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
        eager: true,
        container: "does-not-exist",
      },
    };

    const errors: unknown[] = [];
    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () =>
        Promise.resolve(pbjs as unknown as import("../src/core/dependency-loader").PrebidGlobal),
      consentDisabled: true,
    });
    api.on("error", (e) => errors.push(e));

    await api.registerScript(script);
    await flush();

    expect(errors).toHaveLength(1);
    expect((errors[0] as Record<string, unknown>).code).toBe("E_CONFIG_INVALID");

    const injected = script.nextElementSibling as HTMLElement | null;
    expect(injected).not.toBeNull();
    expect(injected!.dataset.adwrapperSlot).toBe("slot_missing_container");
  });

  it("destroy() clears publisher-provided container contents without removing the element", async () => {
    const publisherDiv = document.createElement("div");
    publisherDiv.id = "persistent-container";
    document.body.appendChild(publisherDiv);

    const script = document.createElement("script");
    script.id = "slot_destroy_test";
    document.body.appendChild(script);

    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_destroy_test: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
        eager: true,
        container: "persistent-container",
      },
    };

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () =>
        Promise.resolve(pbjs as unknown as import("../src/core/dependency-loader").PrebidGlobal),
      consentDisabled: true,
    });

    await api.registerScript(script);
    await flush();

    publisherDiv.innerHTML = "<span>ad content</span>";

    api.destroy("slot_destroy_test");

    expect(document.getElementById("persistent-container")).toBe(publisherDiv);
    expect(publisherDiv.innerHTML).toBe("");
  });

  it("destroy() removes SDK-injected sibling containers (default path unchanged)", async () => {
    const wrapper = document.createElement("section");
    const script = document.createElement("script");
    script.id = "slot_default_destroy";
    wrapper.appendChild(script);
    document.body.appendChild(wrapper);

    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_default_destroy: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
        eager: true,
      },
    };

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () =>
        Promise.resolve(pbjs as unknown as import("../src/core/dependency-loader").PrebidGlobal),
      consentDisabled: true,
    });

    await api.registerScript(script);
    await flush();

    expect(document.querySelector('[data-adwrapper-slot="slot_default_destroy"]')).not.toBeNull();

    api.destroy("slot_default_destroy");

    expect(document.querySelector('[data-adwrapper-slot="slot_default_destroy"]')).toBeNull();
  });
});
