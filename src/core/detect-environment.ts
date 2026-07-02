export type Environment = "webview" | "browser";

export function detectEnvironment(userAgent: string): Environment {
  if (/\bwv\b/.test(userAgent)) return "webview";
  // iOS WKWebView pattern: Mobile + AppleWebKit but no Safari/ token.
  if (/AppleWebKit/.test(userAgent) && /Mobile/.test(userAgent) && !/Safari\//.test(userAgent)) {
    return "webview";
  }
  return "browser";
}

// Execution surface (D65) — WHERE the SDK is running, orthogonal to `Environment`
// (webview/browser). Governs per-surface capability degradation (consent, identity,
// viewability, video) when the SDK runs inside a GAM creative as an unfill backfill.
//   top            — publisher top page (the original D5 context)
//   friendly-iframe — a same-origin ad iframe; window.top is reachable
//   safeframe      — a cross-origin / sandboxed ad iframe; window.top is NOT reachable
export type Surface = "top" | "friendly-iframe" | "safeframe";

interface SurfaceWindow {
  readonly top?: unknown;
  readonly $sf?: { readonly ext?: unknown };
}

// Runtime surface detection. Kept dependency-injectable (win arg) for tests.
// - No window (SSR) → treat as `top` (safe default; framed-only degradations off).
// - Not framed (`win === win.top`) → `top`.
// - Framed: a SafeFrame injects `window.$sf.ext`, and a cross-origin frame throws
//   on any access to `win.top.document`. Either signal → `safeframe`. A same-origin
//   frame reaches `win.top.document` without throwing → `friendly-iframe`.
export function detectSurface(win: unknown = typeof window !== "undefined" ? window : undefined): Surface {
  if (!win) return "top";
  const w = win as SurfaceWindow & { top?: SurfaceWindow; document?: unknown };
  // Not framed.
  if (w.top === undefined || w.top === w) return "top";
  // Definitive SafeFrame host API marker.
  if (w.$sf && w.$sf.ext) return "safeframe";
  // Same-origin frames can touch the top document; cross-origin frames throw
  // SecurityError. The read is CONSUMED (returned in the condition) so a minifier
  // can't drop it as a dead member access and defeat the detection.
  try {
    const topDoc = (w.top as { document?: unknown }).document;
    return topDoc !== undefined ? "friendly-iframe" : "safeframe";
  } catch {
    return "safeframe";
  }
}
