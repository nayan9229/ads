import { WrapperError, ErrorCode } from "./errors";

export const DEFAULT_IMA_SRC = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";
export const DEFAULT_IDENTITY_RESOLVER_SRC =
  "https://cdn.jsdelivr.net/gh/nayan9229/identity-resolver@1.0.8/dist/index.umd.js";

/**
 * Global var name the SDK's own Prebid build writes itself to (D61/D62). The
 * vendored bundle is built with Prebid's `package.json` `globalVarName` set to
 * `_adwPbjs` (Prebid 9 has no `--prebidGlobalVarName` CLI flag — the name is read
 * from package.json), so it never touches the host page's `window.pbjs`. The
 * loader reads this global instead of `window.pbjs`.
 */
export const DEFAULT_PREBID_GLOBAL_VAR = "_adwPbjs";

export interface DependencyLoaderOptions {
  /**
   * Override URL for an external renamed-global Prebid build (D62). Normally
   * omitted: Prebid is inlined into the SDK bundle and `loadPrebid` resolves the
   * already-present global. Only used as a fallback when the global is absent.
   */
  readonly prebidSrc?: string;
  /** Global var name the renamed Prebid build exposes (D61). Defaults to `_adwPbjs`. */
  readonly prebidGlobalVarName?: string;
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

let preExistingImaWarned = false;
let preExistingIdentityResolverWarned = false;

// NOTE: Prebid is intentionally NOT reused from the host page (D61). The SDK
// always self-loads its own renamed-global instance so its required adapters
// (PubMatic, Magnite/rubicon) are guaranteed present. IMA + identity-resolver
// remain shared single-instance globals and are still reused below.
function warnReuse(scope: "ima" | "identityResolver"): void {
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
          new WrapperError(
            ErrorCode.E_IDENTITY_LOAD_FAIL,
            "identity-resolver script onerror fired",
            {
              src,
            },
          ),
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

    // Our own renamed global (default `_adwPbjs`, D61). Never the host's
    // window.pbjs — reusing that meant the host build often lacked our required
    // adapters (PubMatic, Magnite/rubicon) → "adapter not found" at auction.
    const globalVarName = this.opts.prebidGlobalVarName ?? DEFAULT_PREBID_GLOBAL_VAR;
    const win = window as unknown as Record<string, PrebidGlobal | undefined>;

    // Inlined path (D62): the vendored Prebid IIFE is concatenated ahead of this
    // bundle and self-executes, so the global is already present. Resolve it
    // synchronously — no script injection.
    const inlined = win[globalVarName];
    if (inlined && Array.isArray(inlined.que)) {
      this.prebidPromise = Promise.resolve(inlined);
      return this.prebidPromise;
    }

    // Fallback: external renamed-global build via `prebidSrc` override (D44).
    if (this.opts.prebidSrc === undefined) {
      this.prebidPromise = Promise.reject(
        new WrapperError(
          ErrorCode.E_PREBID_LOAD_FAIL,
          `window.${globalVarName} not present (inlined Prebid missing) and no prebidSrc override supplied`,
          { globalVarName },
        ),
      );
      // Avoid an unhandled-rejection warning if no one awaits immediately.
      this.prebidPromise.catch(() => {});
      return this.prebidPromise;
    }

    const prebidSrc = this.opts.prebidSrc;
    this.prebidPromise = new Promise<PrebidGlobal>((resolve, reject) => {
      const script = document.createElement("script");
      script.async = true;
      script.src = prebidSrc;
      if (this.opts.nonce !== undefined) {
        script.setAttribute("nonce", this.opts.nonce);
      }

      const timeout = window.setTimeout(() => {
        reject(
          new WrapperError(
            ErrorCode.E_PREBID_LOAD_FAIL,
            `Prebid load timed out after ${this.opts.timeoutMs}ms`,
            { src: prebidSrc },
          ),
        );
      }, this.opts.timeoutMs);

      script.onload = () => {
        window.clearTimeout(timeout);
        const pbjs = (window as unknown as Record<string, PrebidGlobal | undefined>)[globalVarName];
        if (!pbjs) {
          reject(
            new WrapperError(
              ErrorCode.E_PREBID_LOAD_FAIL,
              `window.${globalVarName} missing after script load`,
              { src: prebidSrc, globalVarName },
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
            src: prebidSrc,
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
  preExistingImaWarned = false;
  preExistingIdentityResolverWarned = false;
}
