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

interface ResolverSignalsShape {
  eids?: Array<{ source: string; uids: Array<{ id: string }> }>;
  buyeruid?: string;
}

function makeResolverStub(signals: ResolverSignalsShape): IdentityResolverGlobal {
  return {
    resolveIdentitySignals: () => signals,
  } as unknown as IdentityResolverGlobal;
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

function findOrtb2Call(pbjs: PbjsStub): Record<string, unknown> | undefined {
  const calls = pbjs.setConfig.mock.calls.map((c) => c[0] as Record<string, unknown>);
  return calls.find((c) => "ortb2" in c);
}

describe("bootstrap — pre-auction identity merge + ortb2 push", () => {
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

  it("still pushes ortb2 (with null resolver signals) when the identity-resolver loader rejects", async () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_load_fail: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "pubmatic", params: {} }],
        eager: true,
      },
    };
    const script = appendScript("slot_load_fail");
    const pbjs = makePbjs();

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      identityResolverLoaderOverride: () => Promise.reject(new Error("blocked by extension")),
      identityResolver: { enabled: true },
      consentDisabled: true,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    expect(pbjs.addAdUnits).toHaveBeenCalled();
    const ortb2Call = findOrtb2Call(pbjs);
    expect(ortb2Call).toBeDefined();
    const ortb2 = ortb2Call!.ortb2 as { user?: { eids?: unknown[] } };
    expect(ortb2.user?.eids ?? []).toEqual([]);
  });

  it("forwards resolver.buyeruid into ortb2.user.buyeruid when consent is not blocked", async () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_buyeruid: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "pubmatic", params: {} }],
        eager: true,
      },
    };
    const script = appendScript("slot_buyeruid");
    const pbjs = makePbjs();
    const resolverStub = makeResolverStub({ eids: [], buyeruid: "buyer-xyz-789" });

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      identityResolverLoaderOverride: () => Promise.resolve(resolverStub),
      identityResolver: { enabled: true },
      consentDisabled: true,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const ortb2Call = findOrtb2Call(pbjs);
    expect(ortb2Call).toBeDefined();
    const ortb2 = ortb2Call!.ortb2 as { user?: { buyeruid?: string } };
    expect(ortb2.user?.buyeruid).toBe("buyer-xyz-789");
  });

  it("pushes pbjs.setConfig({ ortb2: { user: { eids } } }) before pbjs.addAdUnits when resolver returns signals", async () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_eids: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "pubmatic", params: {} }],
        eager: true,
      },
    };
    const script = appendScript("slot_eids");
    const pbjs = makePbjs();
    const resolverStub = makeResolverStub({
      eids: [{ source: "id5-sync.com", uids: [{ id: "id5-abc" }] }],
    });

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      identityResolverLoaderOverride: () => Promise.resolve(resolverStub),
      identityResolver: { enabled: true },
      consentDisabled: true,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const ortb2Call = findOrtb2Call(pbjs);
    expect(ortb2Call).toBeDefined();
    const ortb2 = ortb2Call!.ortb2 as { user?: { eids?: Array<{ source: string }> } };
    const sources = ortb2.user?.eids?.map((e) => e.source) ?? [];
    expect(sources).toContain("id5-sync.com");

    // Order: setConfig with ortb2 must be invoked before addAdUnits.
    const setConfigInvokes = pbjs.setConfig.mock.invocationCallOrder;
    const addAdUnitsInvokes = pbjs.addAdUnits.mock.invocationCallOrder;
    const ortb2CallIndex = pbjs.setConfig.mock.calls.findIndex(
      (c) => (c[0] as Record<string, unknown>).ortb2 !== undefined,
    );
    expect(setConfigInvokes[ortb2CallIndex]!).toBeLessThan(addAdUnitsInvokes[0]!);
  });
});
