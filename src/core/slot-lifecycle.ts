import { CallbackRegistry, Unsubscribe } from "./callback-registry";
import { AdSize, RefreshConfig, ValidatedSlotConfig } from "./config-registry";
import { Surface } from "./detect-environment";
import { BannerRenderer, PrebidBid, PrebidRenderApi } from "../renderers/banner-renderer";
import { NativeBid, NativeRenderer } from "../renderers/native-renderer";
import { VideoBid, VideoRenderer } from "../renderers/video-renderer";
import { FallbackRenderer } from "../renderers/fallback-renderer";
import { AuctionOrchestrator } from "./auction-orchestrator";
import { RetryScheduler } from "./retry-scheduler";
import { LazyLoadGate } from "../gates/lazy-load-gate";
import { ViewabilityTracker } from "../gates/viewability-tracker";
import { ConsentManager } from "./consent-manager";
import { ErrorCode } from "./errors";
import { RefreshScheduler } from "./refresh-scheduler";
import { CurrencyConverter } from "./currency-converter";

export type SlotState =
  | "pending"
  | "gated"
  | "bidding"
  | "won"
  | "rendering"
  | "rendered"
  | "retrying"
  | "noFill"
  | "error"
  | "destroyed";

export interface SlotLifecycleDeps {
  readonly slotId: string;
  readonly config: ValidatedSlotConfig;
  readonly container: HTMLElement;
  readonly callbacks: CallbackRegistry;
  readonly bannerRenderer: BannerRenderer;
  readonly nativeRenderer?: NativeRenderer;
  readonly videoRenderer?: VideoRenderer;
  readonly pbjs: PrebidRenderApi;
  readonly orchestrator?: AuctionOrchestrator;
  readonly retryDelaysMs?: ReadonlyArray<number>;
  readonly isInView?: () => boolean;
  readonly viewportNotifier?: (cb: () => void) => () => void;
  readonly lazyLoadGate?: LazyLoadGate;
  readonly viewabilityTracker?: ViewabilityTracker;
  readonly consentManager?: ConsentManager;
  readonly currencyConverter?: CurrencyConverter;
  readonly suppressRefresh?: boolean;
  // Execution surface (D65). Consumed by later phases for per-surface behavior
  // (safeframe viewability source, outstream→banner fallback). Defaults to `top`.
  readonly surface?: Surface;
}

export class SlotLifecycle {
  private currentState: SlotState = "pending";
  private retryScheduler: RetryScheduler | null = null;
  private retryResolver: ((success: boolean) => void) | null = null;
  private refreshScheduler: RefreshScheduler | null = null;
  private resolvedSizes: ReadonlyArray<AdSize> | null = null;
  private destroyed = false;
  private lazyAborted = false;
  private viewabilityAborted = false;
  private adCompleteTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshCapReached = false;
  // Which mediaType rendered the current impression. Drives refresh cadence
  // (D64: per-mediaType refresh — the rendered type wins, re-evaluated each
  // impression) and whether adComplete is scheduled.
  private renderedMediaType: "banner" | "video" | "native" | null = null;
  private safeframeFallbackDisposers: Unsubscribe[] = [];
  // Video refresh is ad-complete-driven (D66), not timer-driven: this counts how
  // many video refreshes have fired (for sessionCap) and holds the live listener.
  private videoRefreshFires = 0;
  private videoRefreshDisposers: Unsubscribe[] = [];

  constructor(private readonly deps: SlotLifecycleDeps) {}

  state(): SlotState {
    return this.currentState;
  }

  setResolvedSizes(sizes: ReadonlyArray<AdSize>): void {
    this.resolvedSizes = sizes;
  }

  getResolvedSizes(): ReadonlyArray<AdSize> | null {
    return this.resolvedSizes;
  }

  // Instantaneous in-view fraction [0,1] for the auction request (#4/D65) — only
  // available on `safeframe` via `$sf.ext`; undefined elsewhere. The orchestrator
  // stamps it onto `ortb2Imp.ext.data.viewability` so bidders see measured-viewable.
  viewabilitySignal(): number | undefined {
    const v = this.deps.viewabilityTracker?.currentInView();
    return typeof v === "number" ? v : undefined;
  }

  private strippedMediaTypes = new Set<"banner" | "native" | "video">();

  stripMediaType(t: "banner" | "native" | "video"): void {
    this.strippedMediaTypes.add(t);
  }

  getEffectiveMediaTypes(): import("./config-registry").MediaTypes {
    const mt = this.deps.config.mediaTypes;
    if (this.strippedMediaTypes.size === 0) return mt;
    const out: { -readonly [K in keyof typeof mt]: (typeof mt)[K] } = {};
    if (mt.banner && !this.strippedMediaTypes.has("banner")) out.banner = mt.banner;
    if (mt.native && !this.strippedMediaTypes.has("native")) out.native = mt.native;
    if (mt.video && !this.strippedMediaTypes.has("video")) out.video = mt.video;
    return out;
  }

  // P5 (D65): guard a safeframe outstream-video render — on IMA failure/refusal,
  // drop video and re-auction banner-only for this slot; on success, disarm.
  private armSafeframeVideoFallback(): void {
    const disarm = () => {
      for (const off of this.safeframeFallbackDisposers) off();
      this.safeframeFallbackDisposers = [];
    };
    const forThisSlot = (p: unknown): boolean =>
      (p as { slotId?: string })?.slotId === this.deps.slotId;
    const onFail = (p: unknown): void => {
      if (!forThisSlot(p)) return;
      disarm();
      if (this.destroyed || !this.deps.orchestrator) return;
      if (!this.strippedMediaTypes.has("video")) this.stripMediaType("video");
      this.deps.orchestrator.enqueue({
        slotId: this.deps.slotId,
        config: this.deps.config,
        lifecycle: this,
      });
    };
    const onSuccess = (p: unknown): void => {
      if (forThisSlot(p)) disarm(); // video rendered — cancel the fallback
    };
    disarm(); // clear any stale guard from a prior impression
    this.safeframeFallbackDisposers.push(
      this.deps.callbacks.on("adRenderFail", onFail),
      this.deps.callbacks.on("adRenderSuccess", onSuccess),
    );
  }

  // D66: video refresh is triggered by the video ad finishing — either playing to
  // completion (IMA COMPLETE → `adComplete`) OR the user skipping it (IMA SKIPPED →
  // `adSkipped`) — not a timer. On each, re-auction the slot (full re-auction, D64)
  // up to `sessionCap` (completions + skips share the one counter). Re-arms when the
  // re-auction renders video again; the cap guard stops it after `sessionCap`.
  private armVideoRefresh(): void {
    if (this.deps.suppressRefresh || !this.deps.orchestrator || this.refreshCapReached) return;
    const refresh = this.deps.config.mediaTypes.video?.refresh;
    if (!refresh) return;

    const disarm = () => {
      for (const off of this.videoRefreshDisposers) off();
      this.videoRefreshDisposers = [];
    };
    const trigger = (p: unknown): void => {
      const pl = p as { slotId?: string; mediaType?: string };
      if (pl.slotId !== this.deps.slotId || pl.mediaType !== "video") return;
      disarm(); // one-shot (COMPLETE and SKIPPED are mutually exclusive); next render re-arms
      if (this.destroyed || !this.deps.orchestrator) return;

      this.videoRefreshFires += 1;
      this.deps.callbacks.emit("refresh", { slotId: this.deps.slotId });
      this.deps.orchestrator.enqueue({
        slotId: this.deps.slotId,
        config: this.deps.config,
        lifecycle: this,
      });
      const cap = refresh.sessionCap;
      if (cap !== undefined && this.videoRefreshFires >= cap) {
        this.refreshCapReached = true;
        this.deps.callbacks.emit("refresh_cap_reached", { slotId: this.deps.slotId, cap });
      }
    };
    disarm(); // clear any stale listener from a prior impression
    this.videoRefreshDisposers.push(
      this.deps.callbacks.on("adComplete", trigger),
      this.deps.callbacks.on("adSkipped", trigger),
    );
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.lazyAborted = true;
    this.viewabilityAborted = true;
    this.deps.viewabilityTracker?.dispose();
    for (const off of this.safeframeFallbackDisposers) off();
    this.safeframeFallbackDisposers = [];
    for (const off of this.videoRefreshDisposers) off();
    this.videoRefreshDisposers = [];
    if (this.retryScheduler) {
      this.retryScheduler.cancel();
      this.retryScheduler = null;
    }
    if (this.refreshScheduler) {
      this.refreshScheduler.cancel();
      this.refreshScheduler = null;
    }
    if (this.retryResolver) {
      const r = this.retryResolver;
      this.retryResolver = null;
      r(true);
    }
    if (this.adCompleteTimer !== null) {
      clearTimeout(this.adCompleteTimer);
      this.adCompleteTimer = null;
    }
    this.currentState = "destroyed";
    this.deps.callbacks.emit("destroy", { slotId: this.deps.slotId });
  }

  // Refresh config for the mediaType that rendered the current impression
  // (D64). Null before the first render, or when that mediaType opts out.
  private refreshForRenderedMediaType(): RefreshConfig | undefined {
    if (!this.renderedMediaType) return undefined;
    return this.deps.config.mediaTypes[this.renderedMediaType]?.refresh;
  }

  private scheduleAdComplete(): void {
    if (this.refreshForRenderedMediaType() && !this.refreshCapReached) return;
    if (this.adCompleteTimer !== null) {
      clearTimeout(this.adCompleteTimer);
    }
    const delayMs = this.deps.config.adCompleteDelayMs ?? 10_000;
    this.adCompleteTimer = setTimeout(() => {
      this.adCompleteTimer = null;
      if (this.destroyed) return;
      this.deps.callbacks.emit("adComplete", { slotId: this.deps.slotId, mediaType: "banner" });
    }, delayMs);
  }

  start(): void {
    if (!this.deps.orchestrator) return;

    const isEager = this.deps.config.eager === true;
    const lazyPromise =
      isEager || !this.deps.lazyLoadGate
        ? Promise.resolve()
        : this.deps.lazyLoadGate.gate(this.deps.container);

    const consentPromise = this.deps.consentManager
      ? this.deps.consentManager.resolve()
      : Promise.resolve(null);

    this.currentState = "gated";
    void Promise.all([lazyPromise, consentPromise]).then(([, consent]) => {
      if (this.destroyed || this.lazyAborted) return;
      if (consent && consent.blocked) {
        this.currentState = "error";
        this.deps.callbacks.emit("error", {
          slotId: this.deps.slotId,
          code: ErrorCode.E_NO_CMP,
          message: "consent blocked auction",
        });
        return;
      }
      this.enqueueInitial();
    });
  }

  private enqueueInitial(): void {
    this.emitBidderConfig();
    this.deps.orchestrator!.enqueue({
      slotId: this.deps.slotId,
      config: this.deps.config,
      lifecycle: this,
    });
  }

  private emitBidderConfig(): void {
    const bidders = this.deps.config.bidders;
    if (!bidders || bidders.length === 0) return;
    const normalized = bidders.map((b) => ({
      bidder: b.bidder,
      params: normalizeBidderParams(b.params),
    }));
    let bidders_json: string;
    try {
      bidders_json = JSON.stringify(normalized);
    } catch {
      bidders_json = "[]";
    }
    if (bidders_json.length > MAX_BIDDERS_JSON_LEN) {
      bidders_json = bidders_json.slice(0, MAX_BIDDERS_JSON_LEN);
    }
    this.deps.callbacks.emit("bidder_config", {
      slotId: this.deps.slotId,
      bidder_count: bidders.length,
      bidder_names: bidders.map((b) => b.bidder).join(","),
      bidders_json,
    });
  }

  onAuctionWon(bid: PrebidBid | NativeBid | VideoBid): void {
    if (this.destroyed) return;
    this.currentState = "won";
    this.currentState = "rendering";

    // Replace any previously-rendered creative before rendering the new one.
    // On a refresh auction (D17) this slot's container already holds the prior
    // creative; the banner + video renderers `appendChild`, so without clearing
    // here the new creative stacks beneath the old one (duplicate ads). Clearing
    // once at the single render dispatch also covers a mediaType change across a
    // refresh. Native/fallback renderers clear internally; this is idempotent
    // with those and a no-op on first render (empty container).
    this.deps.container.replaceChildren();

    // Branch on the winning bid's mediaType — not on a config-level discriminant.
    const bidMediaType = (bid as { mediaType?: string }).mediaType;
    // Record what actually rendered so refresh (D64) and adComplete read the
    // correct per-mediaType config. Bids omitting mediaType render as banner.
    this.renderedMediaType =
      bidMediaType === "video" ? "video" : bidMediaType === "native" ? "native" : "banner";

    if (bidMediaType === "video") {
      if (!this.deps.videoRenderer) {
        this.deps.callbacks.emit("adRenderFail", {
          slotId: this.deps.slotId,
          reason: "video renderer missing",
        });
        return;
      }
      // Safeframe: outstream video is best-effort (P5/D65). Guard the render so a
      // failed/refused IMA load falls back to a banner auction for this slot.
      if (this.deps.surface === "safeframe") this.armSafeframeVideoFallback();
      // D66: video refresh is event-driven (ad-complete OR user-skip) — arm the
      // listeners (no timer). The video branch returns early, so this is the only
      // refresh path for video.
      this.armVideoRefresh();
      this.deps.videoRenderer.render({
        container: this.deps.container,
        bid: bid as VideoBid,
        slotId: this.deps.slotId,
      });
      this.currentState = "rendered";
      if (this.retryResolver) {
        const r = this.retryResolver;
        this.retryResolver = null;
        r(true);
      }
      return;
    }

    if (bidMediaType === "native") {
      const nativeCfg = this.deps.config.mediaTypes.native;
      if (!this.deps.nativeRenderer || !nativeCfg) {
        this.deps.callbacks.emit("adRenderFail", {
          slotId: this.deps.slotId,
          reason: "native renderer or config missing",
        });
        return;
      }
      const nativeBid = bid as NativeBid & {
        cpm?: number;
        currency?: string;
      };
      const ok = this.deps.nativeRenderer.render({
        container: this.deps.container,
        bid: nativeBid,
        slotId: this.deps.slotId,
        template: nativeCfg.template,
        requiredAssets: nativeCfg.requiredAssets,
      });
      if (!ok) {
        this.onAuctionNoFill();
        return;
      }
      const cpmPayload = this.buildCpmPayload({
        adId: nativeBid.adId,
        width: 0,
        height: 0,
        ...(typeof nativeBid.cpm === "number" ? { cpm: nativeBid.cpm } : {}),
        ...(typeof nativeBid.currency === "string" ? { currency: nativeBid.currency } : {}),
      });
      this.deps.callbacks.emit("adRenderSuccess", {
        slotId: this.deps.slotId,
        adId: nativeBid.adId,
        ...(cpmPayload ?? {}),
      });
    } else {
      // Default: banner. Covers `bidMediaType === "banner"` and bids that omit mediaType.
      const banner = bid as PrebidBid;
      const enrichPayload = this.buildCpmPayload(banner);
      this.deps.bannerRenderer.render({
        container: this.deps.container,
        bid: banner,
        slotId: this.deps.slotId,
        ...(enrichPayload ? { enrichPayload } : {}),
      });
      if (this.deps.config.mediaTypes.banner?.shrinkToAdSize === true) {
        this.deps.container.style.width = `${banner.width}px`;
        this.deps.container.style.height = `${banner.height}px`;
      }
      this.scheduleAdComplete();
    }
    this.currentState = "rendered";

    if (this.retryResolver) {
      const r = this.retryResolver;
      this.retryResolver = null;
      r(true);
    }

    if (this.deps.viewabilityTracker) {
      void this.deps.viewabilityTracker
        .track(this.deps.container, { threshold: 0.5, durationMs: 1000 })
        .then(() => {
          if (this.destroyed || this.viewabilityAborted) return;
          this.deps.callbacks.emit("viewable", { slotId: this.deps.slotId });
          this.startRefreshIfConfigured();
        });
    }
  }

  private startRefreshIfConfigured(): void {
    if (this.destroyed) return;
    if (this.deps.suppressRefresh) return;
    if (!this.deps.orchestrator) return;

    // D64: cadence follows whichever mediaType rendered this impression.
    const refresh = this.refreshForRenderedMediaType();

    // Rendered mediaType has no refresh → this impression does not refresh. If a
    // prior impression's mediaType was refreshing, stop it (the current creative
    // opts out; no further refreshes fire while it is shown). `intervalSec` is
    // absent for video (D66: ad-complete-driven, handled by armVideoCompleteRefresh),
    // which never reaches this timer path — but guard the optional type anyway.
    if (!refresh || refresh.intervalSec === undefined) {
      if (this.refreshScheduler) {
        this.refreshScheduler.cancel();
        this.refreshScheduler = null;
      }
      return;
    }

    // A scheduler is already running from a previous impression: keep it (and its
    // session-cap fire count) but retune to the newly rendered mediaType's rate.
    if (this.refreshScheduler) {
      this.refreshScheduler.updateInterval(refresh.intervalSec * 1000);
      return;
    }

    const isInView = this.deps.isInView ?? (() => true);
    this.refreshScheduler = new RefreshScheduler({
      intervalMs: refresh.intervalSec * 1000,
      isInView,
      ...(refresh.sessionCap !== undefined ? { sessionCap: refresh.sessionCap } : {}),
      ...(this.deps.viewportNotifier ? { viewportNotifier: this.deps.viewportNotifier } : {}),
      onRefresh: () => {
        if (this.destroyed) return;
        this.deps.callbacks.emit("refresh", { slotId: this.deps.slotId });
        this.deps.orchestrator!.enqueue({
          slotId: this.deps.slotId,
          config: this.deps.config,
          lifecycle: this,
        });
      },
      onCapReached: () => {
        if (this.destroyed) return;
        this.refreshCapReached = true;
        const cap = refresh.sessionCap ?? 0;
        this.deps.callbacks.emit("refresh_cap_reached", {
          slotId: this.deps.slotId,
          cap,
        });
      },
    });
    this.refreshScheduler.start();
  }

  onAuctionNoFill(): void {
    if (this.destroyed) return;
    if (this.retryResolver) {
      const r = this.retryResolver;
      this.retryResolver = null;
      r(false);
      return;
    }

    if (this.deps.orchestrator && this.deps.retryDelaysMs && this.deps.retryDelaysMs.length > 0) {
      this.currentState = "retrying";
      this.startRetry();
      return;
    }

    this.currentState = "noFill";
    this.deps.callbacks.emit("noFill", { slotId: this.deps.slotId });
  }

  enterBidding(): void {
    this.currentState = "bidding";
  }

  private buildCpmPayload(bid: PrebidBid): Record<string, unknown> | null {
    if (typeof bid.cpm !== "number") return null;
    const currency = bid.currency ?? "USD";
    const cpmUsd = this.deps.currencyConverter
      ? this.deps.currencyConverter.toUSD(bid.cpm, currency)
      : bid.cpm;
    return { cpm: bid.cpm, currency, cpmUsd };
  }

  private startRetry(): void {
    const isInView = this.deps.isInView ?? (() => true);
    this.retryScheduler = new RetryScheduler({
      delaysMs: this.deps.retryDelaysMs ?? [],
      isInView,
      ...(this.deps.viewportNotifier ? { viewportNotifier: this.deps.viewportNotifier } : {}),
      attempt: () =>
        new Promise<boolean>((resolve) => {
          this.retryResolver = resolve;
          this.deps.orchestrator!.enqueue({
            slotId: this.deps.slotId,
            config: this.deps.config,
            lifecycle: this,
          });
        }),
      onExhausted: () => {
        this.currentState = "noFill";
        if (this.deps.config.fallback) {
          new FallbackRenderer().render(this.deps.container, this.deps.config.fallback);
        }
        this.deps.callbacks.emit("noFill", { slotId: this.deps.slotId });
      },
    });
    this.retryScheduler.start();
  }
}

const MAX_BIDDERS_JSON_LEN = 4000;

const BIDDER_PARAM_DENYLIST: ReadonlySet<string> = new Set([
  "email",
  "hashedEmail",
  "sha256email",
  "sha256_email",
  "uid2",
  "uid2_token",
  "userId",
  "user_id",
  "deviceId",
  "device_id",
  "ifa",
  "idfa",
  "gaid",
  "eids",
  "ip",
  "tcString",
  "gdprConsent",
  "consent",
  "usp",
  "uspString",
  "us_privacy",
]);

function normalizeBidderParams(params: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(params)) {
    if (BIDDER_PARAM_DENYLIST.has(key)) continue;
    const val = params[key];
    if (val === null || val === undefined) continue;
    if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
      out[key] = val;
    } else if (typeof val === "object") {
      try {
        out[key] = JSON.parse(JSON.stringify(val)) as unknown;
      } catch {
        // skip non-serializable
      }
    }
  }
  return out;
}
