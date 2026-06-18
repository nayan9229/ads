import {
  DependencyLoader,
  PrebidGlobal,
  ImaGlobal,
  _resetReuseWarnState,
} from "../src/core/dependency-loader";

function makePbjs(): PrebidGlobal {
  return { que: [] };
}

function makeIma(): ImaGlobal {
  return {
    AdsLoader: function () {} as unknown,
    AdDisplayContainer: function () {} as unknown as ImaGlobal["AdDisplayContainer"],
    AdsRequest: function () {} as unknown as ImaGlobal["AdsRequest"],
    AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: "X" } },
    AdEvent: { Type: {} },
    AdErrorEvent: { Type: { AD_ERROR: "X" } },
  } as unknown as ImaGlobal;
}

describe("DependencyLoader — pre-existing global reuse + warn", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    _resetReuseWarnState();
    document.head.innerHTML = "";
    delete (window as { pbjs?: unknown }).pbjs;
    delete (window as { _adwPbjs?: unknown })._adwPbjs;
    delete (window as { google?: unknown }).google;
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    delete (window as { pbjs?: unknown }).pbjs;
    delete (window as { _adwPbjs?: unknown })._adwPbjs;
    delete (window as { google?: unknown }).google;
  });

  // D61/D62: Prebid is never reused from the host page; the SDK resolves its own
  // inlined _adwPbjs. A host window.pbjs is ignored entirely.
  it("never reuses a host window.pbjs — resolves its own inlined _adwPbjs (D62)", async () => {
    const own = makePbjs();
    (window as unknown as { pbjs: PrebidGlobal }).pbjs = makePbjs();
    (window as unknown as { _adwPbjs: PrebidGlobal })._adwPbjs = own;

    const loader = new DependencyLoader({ timeoutMs: 1000 });
    const resolved = await loader.loadPrebid();

    expect(resolved).toBe(own); // own inlined global, not the host's pbjs
    expect(document.head.querySelector('script[src*="prebid"]')).toBeNull(); // no injection
    expect(warnSpy).not.toHaveBeenCalled(); // no reuse warning
  });

  it("reuses pre-existing window.google.ima and emits one console.warn", async () => {
    const existing = makeIma();
    (window as unknown as { google: { ima: ImaGlobal } }).google = { ima: existing };

    const loader = new DependencyLoader({
      prebidSrc: "https://example.com/prebid.js",
      timeoutMs: 1000,
    });
    const resolved = await loader.loadIMA();

    expect(resolved).toBe(existing);
    expect(document.head.querySelector('script[src*="ima3.js"]')).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toMatch(/reusing pre-existing window\.google\.ima/);
  });

  it("warns once across multiple loadIMA() calls", async () => {
    (window as unknown as { google: { ima: ImaGlobal } }).google = { ima: makeIma() };

    const loader = new DependencyLoader({
      prebidSrc: "https://example.com/prebid.js",
      timeoutMs: 1000,
    });
    await loader.loadIMA();
    await loader.loadIMA();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("warns once even across separate DependencyLoader instances (module-scope state)", async () => {
    (window as unknown as { google: { ima: ImaGlobal } }).google = { ima: makeIma() };

    const a = new DependencyLoader({ prebidSrc: "https://example.com/p.js", timeoutMs: 1000 });
    const b = new DependencyLoader({ prebidSrc: "https://example.com/p.js", timeoutMs: 1000 });
    await a.loadIMA();
    await b.loadIMA();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT warn when no pre-existing ima is on window (normal injection path)", () => {
    const loader = new DependencyLoader({
      prebidSrc: "https://example.com/prebid.js",
      timeoutMs: 1000,
    });
    void loader.loadIMA();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("a host pbjs does not trigger any reuse warning, even alongside ima reuse", async () => {
    (window as unknown as { pbjs: PrebidGlobal }).pbjs = makePbjs();
    (window as unknown as { _adwPbjs: PrebidGlobal })._adwPbjs = makePbjs();
    (window as unknown as { google: { ima: ImaGlobal } }).google = { ima: makeIma() };

    const loader = new DependencyLoader({ timeoutMs: 1000 });
    await loader.loadPrebid();
    await loader.loadIMA();

    // Only the IMA reuse warns; the host pbjs is ignored without comment.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toMatch(/window\.google\.ima/);
  });
});
