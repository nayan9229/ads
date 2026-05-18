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
    getHighestCpmBids: jest.fn().mockReturnValue([]),
    renderAd: jest.fn(),
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  jest.advanceTimersByTime(50);
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function appendScript(slotId: string): HTMLScriptElement {
  const s = document.createElement("script");
  s.id = slotId;
  document.body.appendChild(s);
  return s;
}

function registerEagerSlot(slotId: string): HTMLScriptElement {
  (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
    [slotId]: {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "pubmatic", params: {} }],
      eager: true,
    },
  };
  return appendScript(slotId);
}

describe("bootstrap — schain + ortb2.site passthrough", () => {
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

  it("pushes ortb2 even when identityResolver is disabled (independent passthrough)", async () => {
    const script = registerEagerSlot("slot_ortb2_no_id");
    const pbjs = makePbjs();
    const ortb2 = { site: { cat: ["IAB1"] } };

    // No identityResolver block — identity path is OFF.
    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
      ortb2,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const ortb2Calls = pbjs.setConfig.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((c) => "ortb2" in c);
    const hit = ortb2Calls.find((c) => {
      const o = c.ortb2 as { site?: { cat?: string[] } };
      return o.site?.cat?.includes("IAB1");
    });
    expect(hit).toBeDefined();
  });

  it("pushes pbjs.setConfig({ ortb2 }) with the publisher's ortb2.site block", async () => {
    const script = registerEagerSlot("slot_ortb2");
    const pbjs = makePbjs();
    const ortb2 = {
      site: {
        cat: ["IAB12"],
        content: { keywords: "ad-tech, prebid, demo", language: "en" },
      },
    };

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
      ortb2,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const ortb2Calls = pbjs.setConfig.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((c) => "ortb2" in c);
    expect(ortb2Calls.length).toBeGreaterThanOrEqual(1);
    const merged = ortb2Calls.find((c) => {
      const o = c.ortb2 as { site?: { cat?: string[]; content?: { keywords?: string } } };
      return o.site?.cat?.includes("IAB12") && o.site?.content?.keywords?.includes("prebid");
    });
    expect(merged).toBeDefined();
  });

  it("throws ConfigError when schain is malformed (missing ver)", () => {
    const pbjs = makePbjs();
    expect(() =>
      bootstrap({
        prebidSrc: "https://example.com/prebid.js",
        prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
        consentDisabled: true,
        schain: {
          // ver intentionally missing — invalid IAB SupplyChain
          complete: 1,
          nodes: [{ asi: "x.com", sid: "1", hp: 1 }],
        } as unknown as import("../src/core/bootstrap").SupplyChainObject,
      }),
    ).toThrow(/schain/);
  });

  it("throws ConfigError when schain has empty nodes array", () => {
    const pbjs = makePbjs();
    expect(() =>
      bootstrap({
        prebidSrc: "https://example.com/prebid.js",
        prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
        consentDisabled: true,
        schain: { ver: "1.0", complete: 1, nodes: [] },
      }),
    ).toThrow(/schain.*node/i);
  });

  it("throws ConfigError when a schain node is missing required asi", () => {
    const pbjs = makePbjs();
    expect(() =>
      bootstrap({
        prebidSrc: "https://example.com/prebid.js",
        prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
        consentDisabled: true,
        schain: {
          ver: "1.0",
          complete: 1,
          nodes: [{ sid: "1", hp: 1 } as unknown as import("../src/core/bootstrap").SupplyChainNode],
        },
      }),
    ).toThrow(/schain.*node/i);
  });

  it("does NOT call pbjs.setConfig with a schain key when no schain is configured", async () => {
    const script = registerEagerSlot("slot_no_sc");
    const pbjs = makePbjs();

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const schainCalls = pbjs.setConfig.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((c) => "schain" in c);
    expect(schainCalls).toHaveLength(0);
  });

  it("pushes pbjs.setConfig({ schain }) with the exact supply-chain object when configured", async () => {
    const script = registerEagerSlot("slot_sc");
    const pbjs = makePbjs();
    const schain = {
      ver: "1.0" as const,
      complete: 1 as const,
      nodes: [
        { asi: "example-publisher.com", sid: "pub-12345", hp: 1 as const, name: "Example Publisher" },
      ],
    };

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
      schain,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const schainCalls = pbjs.setConfig.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((c) => "schain" in c);
    expect(schainCalls).toHaveLength(1);
    expect(schainCalls[0]!.schain).toEqual(schain);
  });
});
