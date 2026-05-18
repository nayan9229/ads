import { bootstrap } from "../src/core/bootstrap";
import type { PrebidGlobal } from "../src/core/dependency-loader";
import {
  installIntersectionObserverStub,
  uninstallIntersectionObserverStub,
  triggerEntry,
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
  for (let i = 0; i < 4; i++) await Promise.resolve();
  jest.advanceTimersByTime(50);
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

function setupSlot(slotId: string, pbjs: PbjsStub, configOverrides: Record<string, unknown> = {}) {
  (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
    ...((window as unknown as { AdWrapperConfig?: Record<string, unknown> }).AdWrapperConfig ?? {}),
    [slotId]: {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
      eager: true,
      ...configOverrides,
    },
  };

  const script = document.createElement("script");
  script.id = slotId;
  document.body.appendChild(script);
  return script;
}

describe("AdWrapper.destroy / destroyAll", () => {
  let pbjs: PbjsStub;

  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    jest.useFakeTimers();
    installIntersectionObserverStub();
    pbjs = makePbjs();
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {};
  });
  afterEach(() => {
    jest.useRealTimers();
    uninstallIntersectionObserverStub();
    delete (window as { AdWrapper?: unknown }).AdWrapper;
  });

  it("destroy(slotId) removes the container from the DOM", async () => {
    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
    });

    const script = setupSlot("slot_x", pbjs);
    const reg = api.registerScript(script);
    await flush();
    await reg;

    expect(document.querySelectorAll('[data-adwrapper-slot="slot_x"]')).toHaveLength(1);

    api.destroy("slot_x");

    expect(document.querySelectorAll('[data-adwrapper-slot="slot_x"]')).toHaveLength(0);
  });

  it("emits destroy callback exactly once with slotId payload", async () => {
    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
    });

    const events: unknown[] = [];
    api.on("destroy", (p) => events.push(p));

    const script = setupSlot("slot_d", pbjs);
    const reg = api.registerScript(script);
    await flush();
    await reg;

    api.destroy("slot_d");

    expect(events).toEqual([{ slotId: "slot_d" }]);
  });

  it("calls pbjs.removeAdUnit(slotId) on destroy", async () => {
    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
    });

    const script = setupSlot("slot_r", pbjs);
    const reg = api.registerScript(script);
    await flush();
    await reg;

    api.destroy("slot_r");

    expect(pbjs.removeAdUnit).toHaveBeenCalledWith("slot_r");
  });

  it("cancels pending no-fill RetryScheduler so no further requestBids fire", async () => {
    pbjs.getHighestCpmBids = jest.fn().mockReturnValue([]);
    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
      retryDelaysMs: [100, 200, 400, 800, 1600],
    });

    const script = setupSlot("slot_retry", pbjs);
    const reg = api.registerScript(script);
    await flush();
    await reg;

    // Initial auction made one requestBids call; retry now pending at +100ms.
    expect(pbjs.requestBids).toHaveBeenCalledTimes(1);

    api.destroy("slot_retry");

    await jest.advanceTimersByTimeAsync(5000);
    expect(pbjs.requestBids).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending lazy gate so post-destroy intersection does not auction", async () => {
    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
    });

    const script = setupSlot("slot_lazy_d", pbjs, { eager: false });
    const reg = api.registerScript(script);
    await flush();
    await reg;

    expect(pbjs.requestBids).not.toHaveBeenCalled();

    const container = document.querySelector(
      '[data-adwrapper-slot="slot_lazy_d"]',
    ) as HTMLDivElement | null;
    expect(container).not.toBeNull();

    api.destroy("slot_lazy_d");

    triggerEntry(container!, true);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(100);

    expect(pbjs.requestBids).not.toHaveBeenCalled();
  });

  it("does not emit viewable after destroy even if viewability would have resolved", async () => {
    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
    });

    const seen: unknown[] = [];
    api.on("viewable", (p) => seen.push(p));

    const script = setupSlot("slot_v", pbjs);
    const reg = api.registerScript(script);
    await flush();
    await reg;

    const container = document.querySelector('[data-adwrapper-slot="slot_v"]') as HTMLDivElement;
    triggerEntry(container, true, 0.7);
    await jest.advanceTimersByTimeAsync(500);

    api.destroy("slot_v");

    await jest.advanceTimersByTimeAsync(5000);
    expect(seen).toHaveLength(0);
  });

  it("destroy twice on the same slot is idempotent (single destroy event, no throw)", async () => {
    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
    });

    const events: unknown[] = [];
    api.on("destroy", (p) => events.push(p));

    const script = setupSlot("slot_i", pbjs);
    const reg = api.registerScript(script);
    await flush();
    await reg;

    expect(() => api.destroy("slot_i")).not.toThrow();
    expect(() => api.destroy("slot_i")).not.toThrow();

    expect(events).toEqual([{ slotId: "slot_i" }]);
  });

  it("destroy() on unknown slotId is a no-op (no throw, no event)", () => {
    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
    });

    const events: unknown[] = [];
    api.on("destroy", (p) => events.push(p));

    expect(() => api.destroy("never_registered")).not.toThrow();
    expect(events).toHaveLength(0);
    expect(pbjs.removeAdUnit).not.toHaveBeenCalled();
  });

  it("destroyAll() tears down every registered slot", async () => {
    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
    });

    const events: unknown[] = [];
    api.on("destroy", (p) => events.push(p));

    const s1 = setupSlot("slot_m1", pbjs);
    const s2 = setupSlot("slot_m2", pbjs);
    const s3 = setupSlot("slot_m3", pbjs);
    await Promise.all([api.registerScript(s1), api.registerScript(s2), api.registerScript(s3)]);
    await flush();

    expect(document.querySelectorAll("[data-adwrapper-slot]")).toHaveLength(3);

    api.destroyAll();

    expect(document.querySelectorAll("[data-adwrapper-slot]")).toHaveLength(0);
    expect(events).toHaveLength(3);
    const ids = (events as Array<{ slotId: string }>).map((e) => e.slotId).sort();
    expect(ids).toEqual(["slot_m1", "slot_m2", "slot_m3"]);
  });

  it("registering the same slotId after destroy installs a fresh slot", async () => {
    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
    });

    const renders: unknown[] = [];
    api.on("adRenderSuccess", (p) => renders.push(p));

    const s1 = setupSlot("slot_re", pbjs);
    const reg1 = api.registerScript(s1);
    await flush();
    await reg1;
    expect(renders).toHaveLength(1);

    api.destroy("slot_re");
    expect(document.querySelectorAll('[data-adwrapper-slot="slot_re"]')).toHaveLength(0);

    const s2 = setupSlot("slot_re", pbjs);
    const reg2 = api.registerScript(s2);
    await flush();
    await reg2;

    expect(document.querySelectorAll('[data-adwrapper-slot="slot_re"]')).toHaveLength(1);
    expect(renders).toHaveLength(2);
  });

  it("destroyAll leaves no pending timers", async () => {
    pbjs.getHighestCpmBids = jest.fn().mockReturnValue([]);
    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
      retryDelaysMs: [1000, 2000, 4000, 8000, 16000],
    });

    const s1 = setupSlot("slot_t1", pbjs);
    const s2 = setupSlot("slot_t2", pbjs);
    await Promise.all([api.registerScript(s1), api.registerScript(s2)]);
    await flush();

    expect(jest.getTimerCount()).toBeGreaterThan(0);

    api.destroyAll();

    expect(jest.getTimerCount()).toBe(0);
  });
});
