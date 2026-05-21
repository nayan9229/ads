import { CallbackRegistry } from "../core/callback-registry";

export interface VideoBid {
  readonly adId: string;
  readonly vastUrl?: string;
  readonly vastXml?: string;
  readonly cpm?: number;
  readonly currency?: string;
}

export interface VideoRenderArgs {
  readonly container: HTMLElement;
  readonly bid: VideoBid;
  readonly slotId: string;
}

export interface ImaLike {
  AdsLoader: new (container: unknown) => {
    requestAds(req: unknown): void;
    addEventListener(type: string, cb: (e: unknown) => void): void;
    contentComplete(): void;
  };
  AdDisplayContainer: new (el: HTMLElement, video: HTMLVideoElement) => { initialize(): void };
  AdsRequest: new () => {
    adTagUrl?: string;
    adsResponse?: string;
    setAdWillAutoPlay?(v: boolean): void;
    setAdWillPlayMuted?(v: boolean): void;
  };
  AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: string } };
  AdEvent: { Type: Record<string, string> };
  AdErrorEvent: { Type: { AD_ERROR: string } };
}

export class VideoRenderer {
  constructor(
    private readonly ima: ImaLike,
    private readonly callbacks: CallbackRegistry,
  ) {}

  render(args: VideoRenderArgs): void {
    const video = document.createElement("video");
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute("preload", "auto");
    video.style.width = "100%";
    video.style.height = "100%";
    args.container.appendChild(video);

    const adContainer = document.createElement("div");
    adContainer.style.position = "absolute";
    adContainer.style.inset = "0";
    args.container.style.position = "relative";
    args.container.appendChild(adContainer);

    const adDisplay = new this.ima.AdDisplayContainer(adContainer, video);
    adDisplay.initialize();

    const adsLoader = new this.ima.AdsLoader(adDisplay);
    adsLoader.addEventListener(
      this.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
      (raw: unknown) => {
        const evt = raw as { getAdsManager?: (v: HTMLVideoElement) => unknown };
        const adsManager = evt.getAdsManager?.(video) as
          | {
              addEventListener(type: string, cb: (e: unknown) => void): void;
              init?(w: number, h: number, mode: string): void;
              start?(): void;
            }
          | undefined;
        if (!adsManager) return;

        adsManager.addEventListener(this.ima.AdEvent.Type["STARTED"] as string, () => {
          this.callbacks.emit("adRenderSuccess", {
            slotId: args.slotId,
            adId: args.bid.adId,
            ...(typeof args.bid.cpm === "number"
              ? { cpm: args.bid.cpm, currency: args.bid.currency ?? "USD" }
              : {}),
          });
        });
        adsManager.addEventListener(this.ima.AdEvent.Type["COMPLETE"] as string, () => {
          this.callbacks.emit("viewable", { slotId: args.slotId, complete: true });
          this.callbacks.emit("adComplete", { slotId: args.slotId, mediaType: "video" });
        });

        try {
          adsManager.init?.(
            args.container.clientWidth || 640,
            args.container.clientHeight || 360,
            "normal",
          );
          adsManager.start?.();
        } catch (err) {
          this.callbacks.emit("adRenderFail", {
            slotId: args.slotId,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );
    adsLoader.addEventListener(this.ima.AdErrorEvent.Type.AD_ERROR, (raw: unknown) => {
      const evt = raw as { getError?: () => { getMessage?: () => string } };
      this.callbacks.emit("adRenderFail", {
        slotId: args.slotId,
        reason: evt.getError?.()?.getMessage?.() ?? "IMA AD_ERROR",
      });
    });

    const req = new this.ima.AdsRequest();
    if (args.bid.vastUrl) req.adTagUrl = args.bid.vastUrl;
    if (args.bid.vastXml) req.adsResponse = args.bid.vastXml;
    req.setAdWillAutoPlay?.(true);
    req.setAdWillPlayMuted?.(true);
    adsLoader.requestAds(req);
  }
}
