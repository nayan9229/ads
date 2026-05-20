import { CallbackRegistry } from "./callback-registry";
import { AdSize, ValidatedSlotConfig } from "./config-registry";
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

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.lazyAborted = true;
    this.viewabilityAborted = true;
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
    this.currentState = "destroyed";
    this.deps.callbacks.emit("destroy", { slotId: this.deps.slotId });
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

    // Branch on the winning bid's mediaType — not on a config-level discriminant.
    const bidMediaType = (bid as { mediaType?: string }).mediaType;

    if (bidMediaType === "video") {
      if (!this.deps.videoRenderer) {
        this.deps.callbacks.emit("adRenderFail", {
          slotId: this.deps.slotId,
          reason: "video renderer missing",
        });
        return;
      }
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
    if (this.refreshScheduler) return;
    const refresh = this.deps.config.refresh;
    if (!refresh || !this.deps.orchestrator) return;

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
