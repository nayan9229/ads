import { bootstrap, BootstrapOptions } from "./core/bootstrap";
import type { PrebidGlobal } from "./core/dependency-loader";

declare global {
  interface Window {
    AdWrapper?: ReturnType<typeof bootstrap>;
    AdWrapperConfig?: Record<string, unknown>;
    AdWrapperOptions?: Partial<BootstrapOptions>;
    pbjs?: PrebidGlobal;
  }
}

// The SDK-owned, pinned, renamed-global Prebid build (D62) is INLINED into this
// bundle (vendored artifact concatenated ahead of this code by
// scripts/inline-prebid.mjs). It self-executes and writes window._adwPbjs before
// init() runs, so there is no Prebid URL to load by default — `loadPrebid`
// resolves the already-present global. The host page's window.pbjs is never
// reused (D61). Publishers may still point at an external renamed-global build
// via window.AdWrapperOptions.prebidSrc (override fallback, D44).

function init(): void {
  const overrides = window.AdWrapperOptions ?? {};

  const api = window.AdWrapper ?? bootstrap({ ...overrides });

  const me = document.currentScript as HTMLScriptElement | null;
  if (me && me.id) {
    void api.registerScript(me);
  }
}

init();
