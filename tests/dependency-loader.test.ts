import { DependencyLoader } from "../src/core/dependency-loader";
import { ErrorCode, WrapperError } from "../src/core/errors";

describe("DependencyLoader", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    delete (window as { pbjs?: unknown }).pbjs;
    delete (window as { google?: unknown }).google;
  });

  it("loadPrebid injects a <script> tag with the configured src and resolves on onload", async () => {
    const loader = new DependencyLoader({
      prebidSrc: "https://example.com/prebid.js",
      timeoutMs: 5000,
    });

    const promise = loader.loadPrebid();

    const scriptTag = document.querySelector(
      'script[src="https://example.com/prebid.js"]',
    ) as HTMLScriptElement | null;
    expect(scriptTag).not.toBeNull();
    expect(scriptTag!.async).toBe(true);

    (window as { pbjs?: { que: Array<() => void> } }).pbjs = { que: [] };
    scriptTag!.onload?.(new Event("load"));

    await expect(promise).resolves.toBeDefined();
  });

  it("second loadPrebid call dedupes — does not inject another script tag", async () => {
    const loader = new DependencyLoader({
      prebidSrc: "https://example.com/prebid.js",
      timeoutMs: 5000,
    });

    const p1 = loader.loadPrebid();
    const p2 = loader.loadPrebid();

    expect(p1).toBe(p2);
    expect(document.querySelectorAll('script[src="https://example.com/prebid.js"]')).toHaveLength(
      1,
    );

    const scriptTag = document.querySelector(
      'script[src="https://example.com/prebid.js"]',
    ) as HTMLScriptElement;
    (window as { pbjs?: { que: Array<() => void> } }).pbjs = { que: [] };
    scriptTag.onload?.(new Event("load"));

    await expect(p1).resolves.toBeDefined();
  });

  it("propagates `nonce` option to the injected <script> tag", () => {
    const loader = new DependencyLoader({
      prebidSrc: "https://example.com/prebid.js",
      timeoutMs: 5000,
      nonce: "abc123",
    });

    void loader.loadPrebid();

    const scriptTag = document.querySelector(
      'script[src="https://example.com/prebid.js"]',
    ) as HTMLScriptElement | null;
    expect(scriptTag).not.toBeNull();
    expect(scriptTag!.getAttribute("nonce")).toBe("abc123");
  });

  it("does not set a nonce attribute when no nonce option is supplied", () => {
    const loader = new DependencyLoader({
      prebidSrc: "https://example.com/prebid.js",
      timeoutMs: 5000,
    });

    void loader.loadPrebid();

    const scriptTag = document.querySelector(
      'script[src="https://example.com/prebid.js"]',
    ) as HTMLScriptElement | null;
    expect(scriptTag).not.toBeNull();
    expect(scriptTag!.hasAttribute("nonce")).toBe(false);
  });

  it("loadIMA injects a <script> tag with the configured ima src", () => {
    const loader = new DependencyLoader({
      prebidSrc: "https://example.com/prebid.js",
      imaSrc: "https://imasdk.googleapis.com/js/sdkloader/ima3.js",
      timeoutMs: 5000,
    });

    void loader.loadIMA();

    const scriptTag = document.querySelector(
      'script[src="https://imasdk.googleapis.com/js/sdkloader/ima3.js"]',
    ) as HTMLScriptElement | null;
    expect(scriptTag).not.toBeNull();
  });

  it("loadIMA resolves with google.ima after onload + global set", async () => {
    const loader = new DependencyLoader({
      prebidSrc: "https://example.com/prebid.js",
      imaSrc: "https://imasdk.googleapis.com/js/sdkloader/ima3.js",
      timeoutMs: 5000,
    });

    const promise = loader.loadIMA();
    const scriptTag = document.querySelector(
      'script[src="https://imasdk.googleapis.com/js/sdkloader/ima3.js"]',
    ) as HTMLScriptElement;

    const fakeIma = { tag: "ima" };
    (window as unknown as { google: { ima: unknown } }).google = { ima: fakeIma };
    scriptTag.onload?.(new Event("load"));

    await expect(promise).resolves.toBe(fakeIma);
  });

  it("loadIMA rejects with E_IMA_LOAD_FAIL on timeout", async () => {
    jest.useFakeTimers();
    try {
      const loader = new DependencyLoader({
        prebidSrc: "https://example.com/prebid.js",
        imaSrc: "https://imasdk.googleapis.com/js/sdkloader/ima3.js",
        timeoutMs: 5000,
      });

      const promise = loader.loadIMA();
      jest.advanceTimersByTime(5000);

      await expect(promise).rejects.toBeInstanceOf(WrapperError);
      await expect(promise).rejects.toMatchObject({ code: ErrorCode.E_IMA_LOAD_FAIL });
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects with E_PREBID_LOAD_FAIL when load exceeds timeout", async () => {
    jest.useFakeTimers();
    try {
      const loader = new DependencyLoader({
        prebidSrc: "https://example.com/prebid.js",
        timeoutMs: 5000,
      });
      const promise = loader.loadPrebid();

      jest.advanceTimersByTime(5000);

      await expect(promise).rejects.toBeInstanceOf(WrapperError);
      await expect(promise).rejects.toMatchObject({ code: ErrorCode.E_PREBID_LOAD_FAIL });
    } finally {
      jest.useRealTimers();
    }
  });
});
