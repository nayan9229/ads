import { CallbackRegistry } from "../core/callback-registry";

export interface PrebidBid {
  readonly adId: string;
  readonly width: number;
  readonly height: number;
  readonly cpm?: number;
  readonly currency?: string;
}

export interface RenderArgs {
  readonly container: HTMLElement;
  readonly bid: PrebidBid;
  readonly slotId: string;
  readonly enrichPayload?: Readonly<Record<string, unknown>>;
}

export interface PrebidRenderApi {
  renderAd(doc: Document, adId: string): void;
}

export class BannerRenderer {
  constructor(
    private readonly pbjs: PrebidRenderApi,
    private readonly callbacks: CallbackRegistry,
  ) {}

  render(args: RenderArgs): void {
    const iframe = document.createElement("iframe");
    iframe.width = String(args.bid.width);
    iframe.height = String(args.bid.height);
    iframe.frameBorder = "0";
    iframe.scrolling = "no";
    iframe.style.border = "0";
    iframe.style.margin = "0";
    iframe.style.padding = "0";

    args.container.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) {
      this.callbacks.emit("adRenderFail", {
        slotId: args.slotId,
        reason: "iframe contentDocument null",
      });
      return;
    }

    this.pbjs.renderAd(doc, args.bid.adId);
    this.callbacks.emit("adRenderSuccess", {
      slotId: args.slotId,
      adId: args.bid.adId,
      size: [args.bid.width, args.bid.height],
      ...(args.enrichPayload ?? {}),
    });
  }
}
