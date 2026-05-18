export type Environment = "webview" | "browser";

export function detectEnvironment(userAgent: string): Environment {
  if (/\bwv\b/.test(userAgent)) return "webview";
  // iOS WKWebView pattern: Mobile + AppleWebKit but no Safari/ token.
  if (/AppleWebKit/.test(userAgent) && /Mobile/.test(userAgent) && !/Safari\//.test(userAgent)) {
    return "webview";
  }
  return "browser";
}
