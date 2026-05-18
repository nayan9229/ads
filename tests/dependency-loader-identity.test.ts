import { DependencyLoader, _resetReuseWarnState } from "../src/core/dependency-loader";

interface IdentityResolverGlobalShape {
  resolveIdentitySignals: (...args: unknown[]) => unknown;
  patchBidRequest?: (...args: unknown[]) => unknown;
}

function makeIdentityResolverStub(): IdentityResolverGlobalShape {
  return {
    resolveIdentitySignals: () => ({ eids: [], buyeruid: undefined }),
  };
}

describe("DependencyLoader.loadIdentityResolver", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    _resetReuseWarnState();
    document.head.innerHTML = "";
    delete (window as { OpenRTBIdentityResolver?: unknown }).OpenRTBIdentityResolver;
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    delete (window as { OpenRTBIdentityResolver?: unknown }).OpenRTBIdentityResolver;
  });

  it("memoizes the in-flight promise across repeat loadIdentityResolver calls", () => {
    const loader = new DependencyLoader({
      prebidSrc: "https://example.com/prebid.js",
      timeoutMs: 1000,
    });
    const p1 = loader.loadIdentityResolver();
    const p2 = loader.loadIdentityResolver();
    expect(p2).toBe(p1);
    expect(document.head.querySelectorAll('script[src*="identity-resolver"]')).toHaveLength(1);
    // settle to avoid unhandled rejection
    void p1.catch(() => {});
  });

  it("rejects with E_IDENTITY_LOAD_FAIL when timeoutMs elapses before the script loads", async () => {
    jest.useFakeTimers();
    try {
      const loader = new DependencyLoader({
        prebidSrc: "https://example.com/prebid.js",
        timeoutMs: 500,
      });

      const p = loader.loadIdentityResolver();
      const settled = jest.fn();
      void p.then(settled, settled);

      jest.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();

      expect(settled).toHaveBeenCalledTimes(1);
      const err = settled.mock.calls[0]![0] as { code?: string };
      expect(err.code).toBe("E_IDENTITY_LOAD_FAIL");
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects with E_IDENTITY_LOAD_FAIL when script.onload fires but window.OpenRTBIdentityResolver is absent", async () => {
    const loader = new DependencyLoader({
      prebidSrc: "https://example.com/prebid.js",
      timeoutMs: 1000,
    });

    const p = loader.loadIdentityResolver();
    const script = document.head.querySelector(
      'script[src*="identity-resolver"]',
    ) as HTMLScriptElement | null;
    expect(script).not.toBeNull();

    // global never appears — onload fires anyway (e.g. CSP-stripped global, sandboxed iframe)
    script!.dispatchEvent(new Event("load"));

    await expect(p).rejects.toMatchObject({ code: "E_IDENTITY_LOAD_FAIL" });
  });

  it("injects a script tag with the default jsDelivr src and resolves when window.OpenRTBIdentityResolver appears", async () => {
    const loader = new DependencyLoader({
      prebidSrc: "https://example.com/prebid.js",
      timeoutMs: 1000,
    });

    const p = loader.loadIdentityResolver();
    const script = document.head.querySelector(
      'script[src*="identity-resolver"]',
    ) as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    expect(script!.src).toContain("nayan9229/identity-resolver");

    const stub = makeIdentityResolverStub();
    (window as unknown as { OpenRTBIdentityResolver: IdentityResolverGlobalShape }).OpenRTBIdentityResolver =
      stub;
    script!.dispatchEvent(new Event("load"));

    await expect(p).resolves.toBe(stub);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("reuses pre-existing window.OpenRTBIdentityResolver and emits one console.warn", async () => {
    const existing = makeIdentityResolverStub();
    (window as unknown as { OpenRTBIdentityResolver: IdentityResolverGlobalShape }).OpenRTBIdentityResolver =
      existing;

    const loader = new DependencyLoader({
      prebidSrc: "https://example.com/prebid.js",
      timeoutMs: 1000,
    });
    const resolved = await loader.loadIdentityResolver();

    expect(resolved).toBe(existing);
    expect(document.head.querySelector('script[src*="identity-resolver"]')).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toMatch(/reusing pre-existing window\.OpenRTBIdentityResolver/);
  });
});
