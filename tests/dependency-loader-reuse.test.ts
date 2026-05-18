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

describe("DependencyLoader — pre-existing global reuse + warn (D45)", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    _resetReuseWarnState();
    document.head.innerHTML = "";
    delete (window as { pbjs?: unknown }).pbjs;
    delete (window as { google?: unknown }).google;
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    delete (window as { pbjs?: unknown }).pbjs;
    delete (window as { google?: unknown }).google;
  });

  it("reuses pre-existing window.pbjs and emits one console.warn", async () => {
    const existing = makePbjs();
    (window as unknown as { pbjs: PrebidGlobal }).pbjs = existing;

    const loader = new DependencyLoader({
      prebidSrc: "https://example.com/prebid.js",
      timeoutMs: 1000,
    });
    const resolved = await loader.loadPrebid();

    expect(resolved).toBe(existing);
    expect(document.head.querySelector('script[src*="prebid"]')).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toMatch(/reusing pre-existing window\.pbjs/);
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

  it("warns once across multiple loadPrebid() calls (module-level dedupe)", async () => {
    (window as unknown as { pbjs: PrebidGlobal }).pbjs = makePbjs();

    const loader = new DependencyLoader({
      prebidSrc: "https://example.com/prebid.js",
      timeoutMs: 1000,
    });
    await loader.loadPrebid();
    await loader.loadPrebid();
    await loader.loadPrebid();

    expect(warnSpy).toHaveBeenCalledTimes(1);
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
    (window as unknown as { pbjs: PrebidGlobal }).pbjs = makePbjs();

    const a = new DependencyLoader({ prebidSrc: "https://example.com/p.js", timeoutMs: 1000 });
    const b = new DependencyLoader({ prebidSrc: "https://example.com/p.js", timeoutMs: 1000 });
    await a.loadPrebid();
    await b.loadPrebid();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT warn when no pre-existing pbjs is on window (normal injection path)", () => {
    const loader = new DependencyLoader({
      prebidSrc: "https://example.com/prebid.js",
      timeoutMs: 1000,
    });
    void loader.loadPrebid();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does NOT warn when window.pbjs exists but has no `que` array (invalid pre-existing)", () => {
    (window as unknown as { pbjs: Record<string, unknown> }).pbjs = { something: "else" };

    const loader = new DependencyLoader({
      prebidSrc: "https://example.com/prebid.js",
      timeoutMs: 1000,
    });
    void loader.loadPrebid();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("pbjs warn and ima warn are independent (one does not silence the other)", async () => {
    (window as unknown as { pbjs: PrebidGlobal }).pbjs = makePbjs();
    (window as unknown as { google: { ima: ImaGlobal } }).google = { ima: makeIma() };

    const loader = new DependencyLoader({
      prebidSrc: "https://example.com/prebid.js",
      timeoutMs: 1000,
    });
    await loader.loadPrebid();
    await loader.loadIMA();

    expect(warnSpy).toHaveBeenCalledTimes(2);
    const msgs = warnSpy.mock.calls.map((c) => c[0] as string);
    expect(msgs.some((m) => /window\.pbjs/.test(m))).toBe(true);
    expect(msgs.some((m) => /window\.google\.ima/.test(m))).toBe(true);
  });
});
