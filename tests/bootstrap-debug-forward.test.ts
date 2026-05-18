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

function registerEagerSlot(slotId: string): HTMLScriptElement {
  (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
    [slotId]: {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
    },
  };
  const script = document.createElement("script");
  script.id = slotId;
  document.body.appendChild(script);
  return script;
}

describe("bootstrap — debug forward to Prebid", () => {
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

  it("calls pbjs.setConfig({ debug: true }) when BootstrapOptions.debug === true", async () => {
    const script = registerEagerSlot("slot_dbg_on");

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
      debug: true,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const calls = pbjs.setConfig.mock.calls.map((c) => c[0]) as Array<Record<string, unknown>>;
    expect(calls).toContainEqual({ debug: true });
  });

  it("does not push debug setConfig when BootstrapOptions.debug is omitted", async () => {
    const script = registerEagerSlot("slot_dbg_off");

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const calls = pbjs.setConfig.mock.calls.map((c) => c[0]) as Array<Record<string, unknown>>;
    expect(calls.some((c) => c.debug === true)).toBe(false);
  });

  it("does not push debug setConfig when BootstrapOptions.debug === false", async () => {
    const script = registerEagerSlot("slot_dbg_false");

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
      debug: false,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const calls = pbjs.setConfig.mock.calls.map((c) => c[0]) as Array<Record<string, unknown>>;
    expect(calls.some((c) => c.debug === true)).toBe(false);
  });
});
