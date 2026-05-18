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

const DEFAULT_PREBID_SRC =
  "https://cdn.jsdelivr.net/npm/prebid.js@latest/dist/not-for-prod/prebid.js";

function init(): void {
  const preLoaded = window.pbjs;
  const overrides = window.AdWrapperOptions ?? {};

  const api =
    window.AdWrapper ??
    bootstrap({
      prebidSrc: DEFAULT_PREBID_SRC,
      ...(preLoaded ? { prebidLoaderOverride: () => Promise.resolve(preLoaded) } : {}),
      ...overrides,
    });

  const me = document.currentScript as HTMLScriptElement | null;
  if (me && me.id) {
    void api.registerScript(me);
  }
}

init();
