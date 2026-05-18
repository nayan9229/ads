import { CallbackRegistry, LifecycleEvent, Unsubscribe } from "./callback-registry";
import { ConfigRegistry } from "./config-registry";
import { DependencyLoader, PrebidGlobal } from "./dependency-loader";
import { ErrorRegistry } from "./error-registry";
import { DomInjector } from "../dom/dom-injector";
import { BannerRenderer } from "../renderers/banner-renderer";
import { NativeRenderer } from "../renderers/native-renderer";
import { VideoRenderer } from "../renderers/video-renderer";
import { AuctionOrchestrator, PrebidAuctionApi } from "./auction-orchestrator";
import { SlotLifecycle } from "./slot-lifecycle";
import { ConfigError } from "./errors";
import { LazyLoadGate } from "../gates/lazy-load-gate";
import { ViewabilityTracker } from "../gates/viewability-tracker";
import { ConsentManager } from "./consent-manager";
import { resolveSizesForViewport } from "./resolve-sizes";
import { CspViolationLogger } from "./csp-violation-logger";
import { AnalyticsEmitter } from "./analytics-emitter";
import { CurrencyConverter } from "./currency-converter";
import { IdentityConfig, IdentityResolver } from "./identity-resolver";
import { Environment, detectEnvironment } from "./detect-environment";

export const DEFAULT_RETRY_DELAYS_MS: ReadonlyArray<number> = [1000, 2000, 4000, 8000, 16000];

export interface BootstrapOptions {
  readonly prebidSrc: string;
  readonly timeoutMs?: number;
  readonly prebidLoaderOverride?: () => Promise<PrebidGlobal>;
  readonly imaLoaderOverride?: () => Promise<import("./dependency-loader").ImaGlobal>;
  readonly retryDelaysMs?: ReadonlyArray<number>;
  readonly consentTimeoutMs?: number;
  readonly consentTimezone?: string;
  readonly consentDisabled?: boolean;
  readonly minRefreshIntervalSec?: number;
  readonly cspNonce?: string;
  readonly debug?: boolean;
  readonly analytics?: {
    readonly endpoint: string;
    readonly sampleRate?: number;
  };
  readonly currency?: {
    readonly source?: string;
    readonly ttlMs?: number;
    readonly disabled?: boolean;
  };
  readonly identity?: IdentityConfig;
  readonly environment?: Environment | "auto";
  /**
   * Verbatim Prebid `setConfig` options. Forwarded after Prebid loads.
   * Use this for `debug: true`, `s2sConfig.compression`, `cache`, etc.
   */
  readonly prebidConfig?: Record<string, unknown>;
}

function resolveEnvironment(opt: Environment | "auto" | undefined): Environment {
  if (opt === "webview" || opt === "browser") return opt;
  const ua =
    typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
      ? navigator.userAgent
      : "";
  return detectEnvironment(ua);
}

interface SetConfigCapable {
  setConfig?(cfg: Record<string, unknown>): void;
}

const DEFAULT_FX_SOURCE = "https://currency.prebid.org/latest.json";
const DEFAULT_FX_TTL_MS = 86_400_000;

function generateSessionId(): string {
  return "ses_" + Math.random().toString(36).slice(2, 10) + "_" + Date.now().toString(36);
}

const FORWARDED_EVENTS = [
  "adRenderSuccess",
  "adRenderFail",
  "noFill",
  "viewable",
  "refresh",
  "error",
  "refresh_cap_reached",
] as const;

export interface PublicApi {
  on(event: LifecycleEvent, fn: (payload: unknown) => void): Unsubscribe;
  registerScript(scriptEl: HTMLScriptElement): Promise<void>;
  destroy(slotId: string): void;
  destroyAll(): void;
}

type FullPbjs = PrebidGlobal & PrebidAuctionApi & { renderAd(doc: Document, adId: string): void };

export function bootstrap(opts: BootstrapOptions): PublicApi {
  const existing = (window as unknown as { AdWrapper?: PublicApi }).AdWrapper;
  if (existing) return existing;

  const errors = new ErrorRegistry();
  const callbacks = new CallbackRegistry(errors);
  const configs = new ConfigRegistry({
    ...(opts.minRefreshIntervalSec !== undefined
      ? { minRefreshIntervalSec: opts.minRefreshIntervalSec }
      : {}),
  });
  const injector = new DomInjector();
  const loader = new DependencyLoader({
    prebidSrc: opts.prebidSrc,
    timeoutMs: opts.timeoutMs ?? 5000,
    ...(opts.cspNonce !== undefined ? { nonce: opts.cspNonce } : {}),
  });

  const loadPrebid = opts.prebidLoaderOverride ?? (() => loader.loadPrebid());

  let pbjsCached: FullPbjs | null = null;
  let orchestrator: AuctionOrchestrator | null = null;
  const containers = new Map<string, HTMLDivElement>();
  const lifecycles = new Map<string, SlotLifecycle>();

  // Sniff registered slot configs for any declared mediaTypes.video; if found,
  // preload IMA in parallel with Prebid. Banner-only pages pay zero IMA bytes (D43).
  function anyVideoConfigured(): boolean {
    const globalConfig = (window as unknown as { AdWrapperConfig?: Record<string, unknown> })
      .AdWrapperConfig;
    if (!globalConfig) return false;
    for (const raw of Object.values(globalConfig)) {
      if (raw && typeof raw === "object") {
        const mt = (raw as Record<string, unknown>).mediaTypes as
          | Record<string, unknown>
          | undefined;
        if (mt && mt.video !== undefined) return true;
      }
    }
    return false;
  }

  // imaReadyPromise resolves to the IMA module when loaded, or `null` when
  // unavailable (timeout, error, or no video declared). Per-slot IMA gate
  // (D47) waits on this; pre-auction strip (D46) reads `null` and removes
  // mediaTypes.video from queued slots.
  let imaReadyPromise: Promise<ConstructorParameters<typeof VideoRenderer>[0] | null> | null = null;
  function ensureImaPreload(): Promise<ConstructorParameters<typeof VideoRenderer>[0] | null> {
    if (imaReadyPromise) return imaReadyPromise;
    const load = opts.imaLoaderOverride ?? (() => loader.loadIMA());
    imaReadyPromise = load()
      .then((ima) => ima as unknown as ConstructorParameters<typeof VideoRenderer>[0])
      .catch((err) => {
        callbacks.emit("error", {
          code: "E_IMA_LOAD_FAIL",
          message: err instanceof Error ? err.message : "IMA load failed",
        });
        return null;
      });
    return imaReadyPromise;
  }

  if (typeof window !== "undefined" && anyVideoConfigured()) {
    void ensureImaPreload();
  }

  let cspLogger: CspViolationLogger | null = null;
  if (opts.debug === true) {
    cspLogger = new CspViolationLogger();
    cspLogger.start();
  }

  const currencyConverter: CurrencyConverter | null = opts.currency?.disabled
    ? null
    : new CurrencyConverter({
        source: opts.currency?.source ?? DEFAULT_FX_SOURCE,
        ttlMs: opts.currency?.ttlMs ?? DEFAULT_FX_TTL_MS,
      });
  if (currencyConverter) void currencyConverter.init();

  let analyticsEmitter: AnalyticsEmitter | null = null;
  if (opts.analytics?.endpoint) {
    analyticsEmitter = new AnalyticsEmitter({
      endpoint: opts.analytics.endpoint,
      sessionId: generateSessionId(),
      ...(opts.analytics.sampleRate !== undefined ? { sampleRate: opts.analytics.sampleRate } : {}),
    });
    if (typeof window !== "undefined") analyticsEmitter.attachPageHideFlush(window);
    for (const evt of FORWARDED_EVENTS) {
      callbacks.on(evt, (payload) => {
        analyticsEmitter!.emit(evt, (payload as Record<string, unknown>) ?? {});
      });
    }
  }

  const environment = resolveEnvironment(opts.environment);
  const identityResolver =
    opts.identity && environment !== "webview" ? new IdentityResolver(opts.identity) : null;

  // Defer environment_detected emit so callers can subscribe after bootstrap returns.
  Promise.resolve().then(() => {
    callbacks.emit("environment_detected", { environment });
  });

  async function getPbjs(): Promise<FullPbjs> {
    if (pbjsCached) return pbjsCached;
    pbjsCached = (await loadPrebid()) as FullPbjs;
    orchestrator = new AuctionOrchestrator(pbjsCached);
    const setConfig = (pbjsCached as unknown as SetConfigCapable).setConfig;
    if (typeof setConfig === "function") {
      if (opts.prebidConfig && Object.keys(opts.prebidConfig).length > 0) {
        setConfig.call(pbjsCached, opts.prebidConfig);
      }
      if (opts.debug === true) {
        setConfig.call(pbjsCached, { debug: true });
      }
      if (identityResolver) {
        const userIds = identityResolver.buildUserIdsConfig({ blocked: false });
        if (userIds.length > 0) {
          setConfig.call(pbjsCached, { userSync: { userIds } });
        }
      }
    }
    return pbjsCached;
  }

  const api: PublicApi = {
    on: (event, fn) => callbacks.on(event, fn),

    async registerScript(scriptEl) {
      const slotId = scriptEl.id;
      const globalConfig = (window as unknown as { AdWrapperConfig?: Record<string, unknown> })
        .AdWrapperConfig;
      const raw = globalConfig?.[slotId];
      if (raw === undefined) {
        throw new ConfigError("no config for slot", { slotId });
      }

      if (lifecycles.has(slotId)) {
        api.destroy(slotId);
      }

      const config = configs.register(slotId, raw);

      // Reserved container size — banner-max only per D40. Video is constrained
      // to whatever banner reserves; native uses 300x250 default if no banner.
      let reserved: readonly [number, number] = [300, 250];
      if (config.mediaTypes.banner) {
        const innerWidth =
          typeof window !== "undefined" && typeof window.innerWidth === "number"
            ? window.innerWidth
            : 0;
        const resolved = resolveSizesForViewport(config.mediaTypes.banner.sizes, innerWidth);
        if (resolved.length > 0) {
          const maxW = Math.max(...resolved.map((s) => s[0]));
          const maxH = Math.max(...resolved.map((s) => s[1]));
          reserved = [maxW, maxH];
        }
      }
      const container = injector.inject({
        scriptEl,
        slotId,
        reserved,
      });
      containers.set(slotId, container);

      const pbjs = await getPbjs();
      const bannerRenderer = new BannerRenderer(pbjs, callbacks);
      const nativeRenderer = new NativeRenderer(callbacks);

      // Per-slot IMA-readiness gate (D47): if this slot declares mediaTypes.video,
      // await the preloaded IMA promise (settles either way within timeout).
      let videoRenderer: VideoRenderer | undefined;
      let imaFailed = false;
      if (config.mediaTypes.video) {
        const ima = await ensureImaPreload();
        if (ima) {
          videoRenderer = new VideoRenderer(ima, callbacks);
        } else {
          imaFailed = true;
        }
      }
      const lifecycle = new SlotLifecycle({
        slotId,
        config,
        container,
        callbacks,
        bannerRenderer,
        nativeRenderer,
        ...(videoRenderer ? { videoRenderer } : {}),
        pbjs,
        orchestrator: orchestrator!,
        retryDelaysMs: opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS,
        isInView: () => true,
        lazyLoadGate: new LazyLoadGate(),
        viewabilityTracker: new ViewabilityTracker(),
        ...(opts.consentDisabled
          ? {}
          : {
              consentManager: new ConsentManager({
                timeoutMs: opts.consentTimeoutMs ?? 1000,
                ...(opts.consentTimezone ? { timezone: opts.consentTimezone } : {}),
              }),
            }),
        ...(currencyConverter ? { currencyConverter } : {}),
        ...(environment === "webview" ? { suppressRefresh: true } : {}),
      });

      // D46: pre-auction strip — if IMA failed and slot has banner fallback,
      // strip mediaTypes.video so the auction doesn't return un-renderable video bids.
      if (imaFailed) lifecycle.stripMediaType("video");

      lifecycles.set(slotId, lifecycle);
      lifecycle.start();
    },

    destroy(slotId) {
      const lifecycle = lifecycles.get(slotId);
      if (!lifecycle) return;
      lifecycle.destroy();
      lifecycles.delete(slotId);
      const container = containers.get(slotId);
      if (container) {
        container.remove();
        containers.delete(slotId);
      }
      if (pbjsCached?.removeAdUnit) {
        pbjsCached.removeAdUnit(slotId);
      }
    },

    destroyAll() {
      for (const slotId of [...lifecycles.keys()]) {
        api.destroy(slotId);
      }
      if (cspLogger) {
        cspLogger.dispose();
        cspLogger = null;
      }
      if (analyticsEmitter) {
        analyticsEmitter.dispose();
        analyticsEmitter = null;
      }
    },
  };

  (window as unknown as { AdWrapper?: PublicApi }).AdWrapper = api;
  return api;
}
