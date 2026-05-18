import { detectEnvironment } from "../src/core/detect-environment";

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
