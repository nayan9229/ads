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
import { NewRelicConfig, NewRelicSink } from "./nr-sink";
import { CurrencyConverter } from "./currency-converter";
import { IdentityConfig, IdentityResolver } from "./identity-resolver";
import { Environment, detectEnvironment } from "./detect-environment";

export const DEFAULT_RETRY_DELAYS_MS: ReadonlyArray<number> = [1000, 2000, 4000, 8000, 16000];

export interface SupplyChainNode {
  readonly asi: string;
  readonly sid: string;
  readonly hp: 0 | 1;
  readonly rid?: string;
  readonly name?: string;
  readonly domain?: string;
}

export interface SupplyChainObject {
  readonly ver: "1.0";
  readonly complete: 0 | 1;
  readonly nodes: ReadonlyArray<SupplyChainNode>;
}

export interface IdentityResolverConfig {
  readonly enabled: boolean;
  readonly src?: string;
  readonly version?: string;
  readonly deviceIdCookieName?: string;
  readonly tiers?: ReadonlyArray<1 | 2 | 3 | 4>;
  readonly timeoutMs?: number;
}

export interface BootstrapOptions {
  readonly prebidSrc: string;
  readonly timeoutMs?: number;
  readonly prebidLoaderOverride?: () => Promise<PrebidGlobal>;
  readonly imaLoaderOverride?: () => Promise<import("./dependency-loader").ImaGlobal>;
  readonly identityResolverLoaderOverride?: () => Promise<
    import("./dependency-loader").IdentityResolverGlobal
  >;
  readonly identityResolver?: IdentityResolverConfig;
  readonly schain?: SupplyChainObject;
  readonly ortb2?: Record<string, unknown>;
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
  readonly newrelic?: NewRelicConfig;
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
  "bidder_config",
  "adComplete",
  "adSkipped",
] as const;

export interface PublicApi {
  on(event: LifecycleEvent, fn: (payload: unknown) => void): Unsubscribe;
  registerScript(scriptEl: HTMLScriptElement): Promise<void>;
  /**
   * Register a slot with an explicit container element (D60). For hosts that mount
   * ad surfaces inside a Shadow DOM, where `document.currentScript` auto-init (D6)
   * cannot reach the slot. The host calls this from its framework mount hook, once
   * the (open-rooted) container element exists. `containerEl` is treated as a
   * publisher-owned surface (cleared, not removed, on destroy — per D53).
   */
  registerSlot(slotId: string, containerEl: HTMLElement): Promise<void>;
  destroy(slotId: string): void;
  destroyAll(): void;
}

type FullPbjs = PrebidGlobal & PrebidAuctionApi & { renderAd(doc: Document, adId: string): void };

function validateSchain(raw: SupplyChainObject): void {
  if (raw.ver !== "1.0") {
    throw new ConfigError('`schain.ver` must be "1.0"', { field: "schain.ver", value: raw.ver });
  }
  if (raw.complete !== 0 && raw.complete !== 1) {
    throw new ConfigError("`schain.complete` must be 0 or 1", {
      field: "schain.complete",
      value: raw.complete,
    });
  }
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    throw new ConfigError("`schain.nodes` must be a non-empty array", { field: "schain.nodes" });
  }
  raw.nodes.forEach((n, i) => {
    if (typeof n.asi !== "string" || n.asi.length === 0) {
      throw new ConfigError(`\`schain.nodes[${i}].asi\` must be a non-empty string`, {
        field: `schain.nodes[${i}].asi`,
      });
    }
    if (typeof n.sid !== "string" || n.sid.length === 0) {
      throw new ConfigError(`\`schain.nodes[${i}].sid\` must be a non-empty string`, {
        field: `schain.nodes[${i}].sid`,
      });
    }
    if (n.hp !== 0 && n.hp !== 1) {
      throw new ConfigError(`\`schain.nodes[${i}].hp\` must be 0 or 1`, {
        field: `schain.nodes[${i}].hp`,
      });
    }
  });
}

export function bootstrap(opts: BootstrapOptions): PublicApi {
  const existing = (window as unknown as { AdWrapper?: PublicApi }).AdWrapper;
  if (existing) return existing;

  if (opts.schain !== undefined) validateSchain(opts.schain);

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
  const containers = new Map<string, HTMLElement>();
  const publisherContainers = new Set<string>();
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

  // identityResolver runtime preload — parallel with Prebid + IMA (D43-style sniff).
  // Banner-only pages with identityResolver disabled pay zero bytes.
  let identityReadyPromise: Promise<
    import("./dependency-loader").IdentityResolverGlobal | null
  > | null = null;
  function ensureIdentityResolverPreload(): Promise<
    import("./dependency-loader").IdentityResolverGlobal | null
  > {
    if (identityReadyPromise) return identityReadyPromise;
    const load = opts.identityResolverLoaderOverride ?? (() => loader.loadIdentityResolver());
    identityReadyPromise = load().catch((err: unknown) => {
      callbacks.emit("error", {
        code: "E_IDENTITY_LOAD_FAIL",
        message: err instanceof Error ? err.message : "identity-resolver load failed",
      });
      return null;
    });
    return identityReadyPromise;
  }

  if (
    typeof window !== "undefined" &&
    opts.identityResolver?.enabled === true &&
    resolveEnvironment(opts.environment) !== "webview"
  ) {
    void ensureIdentityResolverPreload();
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

  const sessionId = generateSessionId();

  let analyticsEmitter: AnalyticsEmitter | null = null;
  if (opts.analytics?.endpoint) {
    analyticsEmitter = new AnalyticsEmitter({
      endpoint: opts.analytics.endpoint,
      sessionId,
      ...(opts.analytics.sampleRate !== undefined ? { sampleRate: opts.analytics.sampleRate } : {}),
    });
    if (typeof window !== "undefined") analyticsEmitter.attachPageHideFlush(window);
    for (const evt of FORWARDED_EVENTS) {
      callbacks.on(evt, (payload) => {
        analyticsEmitter!.emit(evt, (payload as Record<string, unknown>) ?? {});
      });
    }
  }

  let nrSink: NewRelicSink | null = null;
  if (opts.newrelic && opts.newrelic.licenseKey && opts.newrelic.applicationID) {
    nrSink = new NewRelicSink({
      config: opts.newrelic,
      sessionId,
    });
    for (const evt of FORWARDED_EVENTS) {
      callbacks.on(evt, (payload) => {
        const data = (payload as Record<string, unknown>) ?? {};
        if (evt === "error") {
          nrSink!.emitError(data);
        } else {
          nrSink!.emit(evt, data);
        }
      });
    }
  }

  const environment = resolveEnvironment(opts.environment);
  const identityResolver =
    opts.identity && environment !== "webview" ? new IdentityResolver(opts.identity) : null;

  const sharedConsentManager: ConsentManager | null = opts.consentDisabled
    ? null
    : new ConsentManager({
        timeoutMs: opts.consentTimeoutMs ?? 1000,
        ...(opts.consentTimezone ? { timezone: opts.consentTimezone } : {}),
      });

  function buildSignalProvider(): import("./auction-orchestrator").SignalProvider {
    return async () => {
      const runtime = await ensureIdentityResolverPreload();
      let resolverSignals: import("./identity-signal-merger").ResolverSignals | null = null;
      if (runtime) {
        try {
          resolverSignals =
            (runtime.resolveIdentitySignals() as import("./identity-signal-merger").ResolverSignals) ??
            null;
        } catch {
          resolverSignals = null;
        }
      }
      const consentState = sharedConsentManager ? await sharedConsentManager.resolve() : null;
      const blocked = consentState?.blocked === true;
      const consent: import("./identity-signal-merger").ConsentSnapshot = {
        blocked,
        tcfApplies: !!consentState?.tcString,
        ...(consentState?.tcString !== undefined ? { tcString: consentState.tcString } : {}),
        ...(consentState?.uspString !== undefined ? { uspString: consentState.uspString } : {}),
      };
      return { resolverSignals, prebidEids: [], consent };
    };
  }

  // Defer environment_detected emit so callers can subscribe after bootstrap returns.
  Promise.resolve().then(() => {
    callbacks.emit("environment_detected", { environment });
  });

  async function getPbjs(): Promise<FullPbjs> {
    if (pbjsCached) return pbjsCached;
    pbjsCached = (await loadPrebid()) as FullPbjs;
    orchestrator = new AuctionOrchestrator(
      pbjsCached,
      opts.identityResolver?.enabled === true ? buildSignalProvider() : undefined,
    );
    const setConfig = (pbjsCached as unknown as SetConfigCapable).setConfig;
    if (typeof setConfig === "function") {
      if (opts.prebidConfig && Object.keys(opts.prebidConfig).length > 0) {
        setConfig.call(pbjsCached, opts.prebidConfig);
      }
      if (opts.debug === true) {
        setConfig.call(pbjsCached, { debug: true });
      }
      if (opts.schain) {
        setConfig.call(pbjsCached, { schain: opts.schain });
      }
      if (opts.ortb2 && Object.keys(opts.ortb2).length > 0) {
        setConfig.call(pbjsCached, { ortb2: opts.ortb2 });
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

  // Shared registration tail for both entry points: the auto-init `<script>` path
  // (registerScript, D6) and the explicit host-driven path (registerSlot, D60).
  // `surface.scriptEl` anchors sibling injection; `surface.explicitContainerEl` is a
  // publisher-owned element handed in directly (Shadow-DOM hosts, D60) and bypasses
  // the config.container string lookup (D53).
  async function bootSlot(
    slotId: string,
    surface: { scriptEl: HTMLScriptElement | null; explicitContainerEl?: HTMLElement },
  ): Promise<void> {
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

    // Resolve the ad surface. An explicit element (registerSlot, D60) is a
    // publisher-owned surface and skips the config.container string path (D53).
    let resolvedContainerEl: HTMLElement | undefined = surface.explicitContainerEl;
    if (resolvedContainerEl) {
      publisherContainers.add(slotId);
    } else if (config.container) {
      const found = document.getElementById(config.container);
      if (found) {
        resolvedContainerEl = found;
        publisherContainers.add(slotId);
      } else {
        callbacks.emit("error", {
          code: "E_CONFIG_INVALID",
          message: `container element "#${config.container}" not found for slot "${slotId}"; falling back to sibling injection`,
          context: { slotId, field: "container", value: config.container },
        });
      }
    }

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
      scriptEl: surface.scriptEl,
      slotId,
      reserved,
      ...(resolvedContainerEl ? { containerEl: resolvedContainerEl } : {}),
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
      ...(sharedConsentManager ? { consentManager: sharedConsentManager } : {}),
      ...(currencyConverter ? { currencyConverter } : {}),
      ...(environment === "webview" ? { suppressRefresh: true } : {}),
    });

    // D46: pre-auction strip — if IMA failed and slot has banner fallback,
    // strip mediaTypes.video so the auction doesn't return un-renderable video bids.
    if (imaFailed) lifecycle.stripMediaType("video");

    lifecycles.set(slotId, lifecycle);
    lifecycle.start();
  }

  const api: PublicApi = {
    on: (event, fn) => callbacks.on(event, fn),

    // Auto-init path (D6): self-executing `<script>` per slot, anchor = document.currentScript.
    async registerScript(scriptEl) {
      await bootSlot(scriptEl.id, { scriptEl });
    },

    // Host-driven path (D60): Shadow-DOM hosts hand the container element in from a
    // framework mount hook. `document.currentScript` is null inside shadow roots, so
    // auto-init cannot serve these slots — the host pushes the element instead.
    async registerSlot(slotId, containerEl) {
      if (!(containerEl instanceof HTMLElement)) {
        throw new TypeError(`registerSlot: containerEl must be an HTMLElement (slot "${slotId}")`);
      }
      await bootSlot(slotId, { scriptEl: null, explicitContainerEl: containerEl });
    },

    destroy(slotId) {
      const lifecycle = lifecycles.get(slotId);
      if (!lifecycle) return;
      lifecycle.destroy();
      lifecycles.delete(slotId);
      const container = containers.get(slotId);
      if (container) {
        if (publisherContainers.has(slotId)) {
          container.innerHTML = "";
          publisherContainers.delete(slotId);
        } else {
          container.remove();
        }
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
      if (nrSink) {
        nrSink.dispose();
        nrSink = null;
      }
    },
  };

  (window as unknown as { AdWrapper?: PublicApi }).AdWrapper = api;
  return api;
}
