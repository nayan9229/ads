import { WrapperError, ErrorCode } from "./errors";

export const DEFAULT_IMA_SRC = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";
export const DEFAULT_IDENTITY_RESOLVER_SRC =
  "https://cdn.jsdelivr.net/gh/nayan9229/identity-resolver@1.0.8/dist/index.umd.js";

export interface DependencyLoaderOptions {
  readonly prebidSrc: string;
  readonly imaSrc?: string;
  readonly identityResolverSrc?: string;
  readonly timeoutMs: number;
  readonly nonce?: string;
}

export interface IdentityResolverGlobal {
  resolveIdentitySignals: (...args: unknown[]) => unknown;
  patchBidRequest?: (...args: unknown[]) => unknown;
  [k: string]: unknown;
}

export interface PrebidGlobal {
  que: Array<() => void>;
  [k: string]: unknown;
}

export interface ImaGlobal {
  AdsLoader: unknown;
  AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: string } };
  AdsRequest: new () => { adTagUrl?: string; adsResponse?: string };
  AdDisplayContainer: new (el: HTMLElement, video: HTMLVideoElement) => { initialize(): void };
  AdEvent: { Type: Record<string, string> };
  AdErrorEvent: { Type: { AD_ERROR: string } };
  [k: string]: unknown;
}

let preExistingPbjsWarned = false;
let preExistingImaWarned = false;
let preExistingIdentityResolverWarned = false;

function warnReuse(scope: "pbjs" | "ima" | "identityResolver"): void {
  if (scope === "pbjs" && !preExistingPbjsWarned) {
    preExistingPbjsWarned = true;
    console.warn(
      "[AdWrapper] reusing pre-existing window.pbjs — confirm the host page's Prebid build includes the bidders + modules this SDK expects.",
    );
  }
  if (scope === "ima" && !preExistingImaWarned) {
    preExistingImaWarned = true;
    console.warn(
      "[AdWrapper] reusing pre-existing window.google.ima — skipping IMA script injection.",
    );
  }
  if (scope === "identityResolver" && !preExistingIdentityResolverWarned) {
    preExistingIdentityResolverWarned = true;
    console.warn(
      "[AdWrapper] reusing pre-existing window.OpenRTBIdentityResolver — skipping identity-resolver script injection.",
    );
  }
}

export class DependencyLoader {
  private prebidPromise: Promise<PrebidGlobal> | null = null;
  private imaPromise: Promise<ImaGlobal> | null = null;
  private identityResolverPromise: Promise<IdentityResolverGlobal> | null = null;

  constructor(private readonly opts: DependencyLoaderOptions) {}

  loadIdentityResolver(): Promise<IdentityResolverGlobal> {
    if (this.identityResolverPromise) return this.identityResolverPromise;

    const existing = (window as unknown as { OpenRTBIdentityResolver?: IdentityResolverGlobal })
      .OpenRTBIdentityResolver;
    if (existing && typeof existing.resolveIdentitySignals === "function") {
      warnReuse("identityResolver");
      this.identityResolverPromise = Promise.resolve(existing);
      return this.identityResolverPromise;
    }

    const src = this.opts.identityResolverSrc ?? DEFAULT_IDENTITY_RESOLVER_SRC;

    this.identityResolverPromise = new Promise<IdentityResolverGlobal>((resolve, reject) => {
      const script = document.createElement("script");
      script.async = true;
      script.src = src;
      if (this.opts.nonce !== undefined) {
        script.setAttribute("nonce", this.opts.nonce);
      }

      const timeout = window.setTimeout(() => {
        reject(
          new WrapperError(
            ErrorCode.E_IDENTITY_LOAD_FAIL,
            `identity-resolver load timed out after ${this.opts.timeoutMs}ms`,
            { src },
          ),
        );
      }, this.opts.timeoutMs);

      script.onload = () => {
        window.clearTimeout(timeout);
        const g = (window as unknown as { OpenRTBIdentityResolver?: IdentityResolverGlobal })
          .OpenRTBIdentityResolver;
        if (!g || typeof g.resolveIdentitySignals !== "function") {
          reject(
            new WrapperError(
              ErrorCode.E_IDENTITY_LOAD_FAIL,
              "window.OpenRTBIdentityResolver missing after script load",
              { src },
            ),
          );
          return;
        }
        resolve(g);
      };

      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(
          new WrapperError(ErrorCode.E_IDENTITY_LOAD_FAIL, "identity-resolver script onerror fired", {
            src,
          }),
        );
      };

      document.head.appendChild(script);
    });

    return this.identityResolverPromise;
  }

  loadIMA(): Promise<ImaGlobal> {
    if (this.imaPromise) return this.imaPromise;

    const existing = (window as unknown as { google?: { ima?: ImaGlobal } }).google?.ima;
    if (existing) {
      warnReuse("ima");
      this.imaPromise = Promise.resolve(existing);
      return this.imaPromise;
    }

    const src = this.opts.imaSrc ?? DEFAULT_IMA_SRC;

    this.imaPromise = new Promise<ImaGlobal>((resolve, reject) => {
      const script = document.createElement("script");
      script.async = true;
      script.src = src;
      if (this.opts.nonce !== undefined) {
        script.setAttribute("nonce", this.opts.nonce);
      }

      const timeout = window.setTimeout(() => {
        reject(
          new WrapperError(
            ErrorCode.E_IMA_LOAD_FAIL,
            `IMA load timed out after ${this.opts.timeoutMs}ms`,
            { src },
          ),
        );
      }, this.opts.timeoutMs);

      script.onload = () => {
        window.clearTimeout(timeout);
        const g = (window as unknown as { google?: { ima?: ImaGlobal } }).google?.ima;
        if (!g) {
          reject(
            new WrapperError(
              ErrorCode.E_IMA_LOAD_FAIL,
              "window.google.ima missing after script load",
              { src },
            ),
          );
          return;
        }
        resolve(g);
      };

      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(new WrapperError(ErrorCode.E_IMA_LOAD_FAIL, "IMA script onerror fired", { src }));
      };

      document.head.appendChild(script);
    });

    return this.imaPromise;
  }

  loadPrebid(): Promise<PrebidGlobal> {
    if (this.prebidPromise) return this.prebidPromise;

    const existing = (window as unknown as { pbjs?: PrebidGlobal }).pbjs;
    if (existing && Array.isArray(existing.que)) {
      warnReuse("pbjs");
      this.prebidPromise = Promise.resolve(existing);
      return this.prebidPromise;
    }

    this.prebidPromise = new Promise<PrebidGlobal>((resolve, reject) => {
      const script = document.createElement("script");
      script.async = true;
      script.src = this.opts.prebidSrc;
      if (this.opts.nonce !== undefined) {
        script.setAttribute("nonce", this.opts.nonce);
      }

      const timeout = window.setTimeout(() => {
        reject(
          new WrapperError(
            ErrorCode.E_PREBID_LOAD_FAIL,
            `Prebid load timed out after ${this.opts.timeoutMs}ms`,
            { src: this.opts.prebidSrc },
          ),
        );
      }, this.opts.timeoutMs);

      script.onload = () => {
        window.clearTimeout(timeout);
        const pbjs = (window as { pbjs?: PrebidGlobal }).pbjs;
        if (!pbjs) {
          reject(
            new WrapperError(
              ErrorCode.E_PREBID_LOAD_FAIL,
              "window.pbjs missing after script load",
              { src: this.opts.prebidSrc },
            ),
          );
          return;
        }
        resolve(pbjs);
      };

      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(
          new WrapperError(ErrorCode.E_PREBID_LOAD_FAIL, "Prebid script onerror fired", {
            src: this.opts.prebidSrc,
          }),
        );
      };

      document.head.appendChild(script);
    });

    return this.prebidPromise;
  }
}

// Exposed for tests that need a fresh module-level reuse-warn state.
export function _resetReuseWarnState(): void {
  preExistingPbjsWarned = false;
  preExistingImaWarned = false;
  preExistingIdentityResolverWarned = false;
}
