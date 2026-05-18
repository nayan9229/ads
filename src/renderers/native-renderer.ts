import { CallbackRegistry } from "../core/callback-registry";

export interface NativeAssets {
  readonly title?: string;
  readonly body?: string;
  readonly cta?: string;
  readonly sponsoredBy?: string;
  readonly image?: { readonly url: string };
  readonly icon?: { readonly url: string };
  readonly clickUrl?: string;
  readonly clickTrackers?: ReadonlyArray<string>;
  readonly impressionTrackers?: ReadonlyArray<string>;
}

export interface NativeBid {
  readonly adId: string;
  readonly native: NativeAssets;
}

export interface NativeRenderArgs {
  readonly container: HTMLElement;
  readonly bid: NativeBid;
  readonly slotId: string;
  readonly template: string;
  readonly requiredAssets: ReadonlyArray<string>;
}

const TEXT_PLACEHOLDERS = ["title", "body", "cta", "sponsoredBy"] as const;

function isHttpsUrl(s: string | undefined): boolean {
  if (typeof s !== "string") return false;
  return s.startsWith("https://");
}

export class NativeRenderer {
  constructor(private readonly callbacks: CallbackRegistry) {}

  render(args: NativeRenderArgs): boolean {
    const { container, bid, slotId, template, requiredAssets } = args;
    const assets = bid.native;

    for (const required of requiredAssets) {
      const v = (assets as Record<string, unknown>)[required];
      const present = v !== undefined && v !== null && (typeof v !== "string" || v.length > 0);
      if (!present) {
        this.fail(slotId, `missing required asset: ${required}`);
        return false;
      }
    }

    if (assets.image !== undefined && !isHttpsUrl(assets.image.url)) {
      this.fail(slotId, "image url not https");
      return false;
    }

    if (assets.icon !== undefined && !isHttpsUrl(assets.icon.url)) {
      this.fail(slotId, "icon url not https");
      return false;
    }

    if (assets.clickUrl !== undefined && !isHttpsUrl(assets.clickUrl)) {
      this.fail(slotId, "clickUrl not https");
      return false;
    }

    let html = template;
    for (const key of TEXT_PLACEHOLDERS) {
      const value = (assets as Record<string, unknown>)[key];
      const safe = typeof value === "string" ? value : "";
      html = html.split(`{{${key}}}`).join(this.escapeForText(safe));
    }

    container.innerHTML = html;

    for (const url of assets.impressionTrackers ?? []) {
      if (!isHttpsUrl(url)) continue;
      const px = new Image();
      px.src = url;
    }

    const root = container.firstElementChild as HTMLElement | null;
    if (root) {
      const trackers = assets.clickTrackers ?? [];
      root.addEventListener("click", () => {
        for (const url of trackers) {
          if (!isHttpsUrl(url)) continue;
          const px = new Image();
          px.src = url;
        }
      });
    }

    return true;
  }

  private fail(slotId: string, reason: string): void {
    this.callbacks.emit("adRenderFail", { slotId, reason });
  }

  private escapeForText(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
