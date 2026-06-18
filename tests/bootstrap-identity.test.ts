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

describe("bootstrap — identity wiring", () => {
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
    delete (window as { pbjs?: unknown }).pbjs;
  });

  it("calls pbjs.setConfig with userSync.userIds when identity is configured", async () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_id: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: {} }],
        eager: true,
      },
    };
    const script = document.createElement("script");
    script.id = "slot_id";
    document.body.appendChild(script);

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
      identity: { id5PartnerId: 4242 },
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const setConfigCalls = pbjs.setConfig.mock.calls.map((c) => c[0]) as Array<{
      userSync?: { userIds: Array<{ name: string }> };
    }>;
    const userSyncCall = setConfigCalls.find((c) => !!c.userSync);
    expect(userSyncCall).toBeDefined();
    const names = userSyncCall!.userSync!.userIds.map((u) => u.name);
    expect(names).toContain("sharedId");
    expect(names).toContain("id5Id");
  });

  it("suppresses our instance's syncs (syncEnabled:false) when a host pbjs is present (D61)", async () => {
    // Host page already runs its own Prebid.
    (window as unknown as { pbjs: { que: Array<() => void> } }).pbjs = { que: [] };

    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_id: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: {} }],
        eager: true,
      },
    };
    const script = document.createElement("script");
    script.id = "slot_id";
    document.body.appendChild(script);

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
      identity: { id5PartnerId: 4242 },
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const userSyncCalls = pbjs.setConfig.mock.calls
      .map((c) => c[0])
      .filter((c) => !!(c as { userSync?: unknown }).userSync) as Array<{
      userSync: { syncEnabled?: boolean; userIds?: unknown };
    }>;

    // Exactly the suppression call — never a userIds push when host is present.
    expect(userSyncCalls).toHaveLength(1);
    expect(userSyncCalls[0]!.userSync.syncEnabled).toBe(false);
    expect(userSyncCalls[0]!.userSync.userIds).toBeUndefined();
  });

  it("webview environment suppresses identity setConfig even when identity is configured", async () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_id_wv: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: {} }],
        eager: true,
      },
    };
    const script = document.createElement("script");
    script.id = "slot_id_wv";
    document.body.appendChild(script);

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
      identity: { id5PartnerId: 4242 },
      environment: "webview",
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const calls = pbjs.setConfig.mock.calls.map((c) => c[0]) as Array<{ userSync?: unknown }>;
    expect(calls.some((c) => "userSync" in c)).toBe(false);
  });

  it("does not call pbjs.setConfig with userSync when identity is absent", async () => {
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_id_no: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: {} }],
        eager: true,
      },
    };
    const script = document.createElement("script");
    script.id = "slot_id_no";
    document.body.appendChild(script);

    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
      consentDisabled: true,
    });

    const reg = api.registerScript(script);
    await flush();
    await reg;

    const calls = pbjs.setConfig.mock.calls.map((c) => c[0]) as Array<{ userSync?: unknown }>;
    expect(calls.some((c) => "userSync" in c)).toBe(false);
  });
});
