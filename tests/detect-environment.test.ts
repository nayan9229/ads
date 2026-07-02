import { detectEnvironment, detectSurface } from "../src/core/detect-environment";

describe("detectEnvironment", () => {
  it("returns 'webview' for Android `wv` user agent", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36";
    expect(detectEnvironment(ua)).toBe("webview");
  });

  it("returns 'webview' for iOS WKWebView UA (Mobile + AppleWebKit, no Safari/)", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
    expect(detectEnvironment(ua)).toBe("webview");
  });

  it("returns 'browser' for regular Chrome desktop UA", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(detectEnvironment(ua)).toBe("browser");
  });
});

describe("detectSurface", () => {
  it("returns 'top' when there is no window (SSR)", () => {
    expect(detectSurface(undefined)).toBe("top");
  });

  it("returns 'top' when the window is its own top (not framed)", () => {
    const win: Record<string, unknown> = { document: {} };
    win.top = win; // window === window.top
    expect(detectSurface(win)).toBe("top");
  });

  it("returns 'safeframe' when the SafeFrame host API ($sf.ext) is present", () => {
    const win = { top: { get document() { throw new Error("cross-origin"); } }, $sf: { ext: {} } };
    expect(detectSurface(win)).toBe("safeframe");
  });

  it("returns 'safeframe' when framed and window.top.document access throws (cross-origin)", () => {
    const top = {
      get document() {
        throw new DOMException("Blocked a frame from accessing a cross-origin frame.", "SecurityError");
      },
    };
    const win = { top };
    expect(detectSurface(win)).toBe("safeframe");
  });

  it("returns 'friendly-iframe' when framed but window.top.document is reachable (same-origin)", () => {
    const top = { document: {} };
    const win = { top }; // win !== win.top, and top.document accessible
    expect(detectSurface(win)).toBe("friendly-iframe");
  });
});
