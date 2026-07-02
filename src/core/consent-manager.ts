import { Surface } from "./detect-environment";

export interface ConsentState {
  readonly tcString?: string;
  readonly uspString?: string;
  readonly blocked: boolean;
}

export interface ConsentManagerOptions {
  readonly timeoutMs: number;
  readonly timezone?: string;
  // Execution surface (D65). Governs how the CMP API is reached:
  //   top            → window.__tcfapi (CMP on this page)
  //   friendly-iframe → window.top.__tcfapi (same-origin, reachable)
  //   safeframe      → IAB cross-frame __tcfLocator postMessage bridge
  readonly surface?: Surface;
}

interface TcfApi {
  (command: string, version: number, cb: (data: TcData | null, success: boolean) => void): void;
}

interface TcData {
  readonly tcString?: string;
  readonly eventStatus?: string;
  readonly gdprApplies?: boolean;
  readonly purpose?: { readonly consents?: Record<number, boolean> };
}

interface UspApi {
  (command: string, version: number, cb: (data: UspData | null, success: boolean) => void): void;
}

interface UspData {
  readonly uspString?: string;
}

// IAB cross-frame CMP protocol descriptors — one per API (TCF / USP).
interface CmpBridgeConfig {
  readonly apiName: "__tcfapi" | "__uspapi";
  readonly locatorName: "__tcfLocator" | "__uspLocator";
  readonly callKey: "__tcfapiCall" | "__uspapiCall";
  readonly returnKey: "__tcfapiReturn" | "__uspapiReturn";
}

const TCF_BRIDGE: CmpBridgeConfig = {
  apiName: "__tcfapi",
  locatorName: "__tcfLocator",
  callKey: "__tcfapiCall",
  returnKey: "__tcfapiReturn",
};

const USP_BRIDGE: CmpBridgeConfig = {
  apiName: "__uspapi",
  locatorName: "__uspLocator",
  callKey: "__uspapiCall",
  returnKey: "__uspapiReturn",
};

type AnyApi = (command: string, version: number, cb: (data: unknown, success: boolean) => void) => void;

let cmpCallCounter = 0;

// Walk from the current window up its ancestors, returning the first frame that
// hosts the CMP locator iframe (`__tcfLocator` / `__uspLocator`). Cross-origin
// ancestors throw on access and are skipped. Returns null if no CMP is present.
function findCmpFrame(locatorName: string): Window | null {
  let f: Window | null = typeof window !== "undefined" ? window : null;
  while (f) {
    try {
      if (f.frames && (f.frames as unknown as Record<string, unknown>)[locatorName] !== undefined) {
        return f;
      }
    } catch {
      /* cross-origin ancestor — cannot inspect its frames; keep walking */
    }
    if (f === f.parent) break;
    f = f.parent;
  }
  return null;
}

interface CmpBridge {
  // Invoke a CMP command (TCF or USP) over the shared postMessage channel.
  call(cfg: CmpBridgeConfig, command: string, version: number, cb: (data: unknown, success: boolean) => void): void;
  dispose(): void;
}

// A single IAB cross-frame postMessage channel to the CMP, shared by TCF + USP.
// Target frame: the ancestor hosting a locator iframe when it's same-origin-
// reachable, else `window.top` — because a cross-origin SafeFrame CANNOT read
// `ancestor.frames['__tcfLocator']` (named cross-origin access throws), yet
// `postMessage` to the top window IS allowed and reaches a top-page CMP.
// Installs exactly ONE `message` listener (removed by dispose) and prunes
// one-shot callbacks, so nothing accumulates across per-auction resolve() calls.
function createCmpBridge(): CmpBridge | null {
  if (typeof window === "undefined") return null;
  const target: Window | null =
    findCmpFrame("__tcfLocator") ?? findCmpFrame("__uspLocator") ?? window.top ?? null;
  if (!target) return null;

  const callbacks = new Map<string, { cb: (d: unknown, s: boolean) => void; oneShot: boolean }>();
  const onMessage = (event: MessageEvent): void => {
    // Only trust replies from the CMP frame we posted to — a foreign frame must
    // not be able to forge a consent response.
    if (event.source !== target) return;
    let payload: unknown = event.data;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        return;
      }
    }
    for (const returnKey of ["__tcfapiReturn", "__uspapiReturn"] as const) {
      const ret = (
        payload as Record<string, { callId?: string; returnValue?: unknown; success?: boolean } | undefined>
      )?.[returnKey];
      if (!ret || typeof ret.callId !== "string") continue;
      const entry = callbacks.get(ret.callId);
      if (!entry) continue;
      entry.cb(ret.returnValue, ret.success === true);
      if (entry.oneShot) callbacks.delete(ret.callId); // addEventListener keeps firing; others are one-shot
    }
  };
  window.addEventListener("message", onMessage, false);

  return {
    call(cfg, command, version, cb) {
      const callId = `adw-${cfg.apiName}-${cmpCallCounter++}`;
      callbacks.set(callId, { cb, oneShot: command !== "addEventListener" });
      try {
        target.postMessage({ [cfg.callKey]: { command, parameter: undefined, version, callId } }, "*");
      } catch {
        /* postMessage can throw in exotic sandboxes — treat as no CMP */
      }
    },
    dispose() {
      window.removeEventListener("message", onMessage, false);
      callbacks.clear();
    },
  };
}

// A direct (non-bridge) CMP API, if reachable: in-frame on `top`, or the
// same-origin top window on `friendly-iframe`. Null → caller must use the bridge.
function resolveDirectApi(cfg: CmpBridgeConfig, surface: Surface): AnyApi | null {
  if (typeof window === "undefined") return null;
  const direct = (window as unknown as Record<string, unknown>)[cfg.apiName];
  if (typeof direct === "function") return direct as AnyApi;
  if (surface !== "safeframe") {
    try {
      const top = window.top as unknown as Record<string, unknown> | null;
      if (top && typeof top[cfg.apiName] === "function") return top[cfg.apiName] as AnyApi;
    } catch {
      /* cross-origin top — caller falls back to the bridge */
    }
  }
  return null;
}

const EU_TZ_PREFIXES = ["Europe/"];
const UK_TZ = "Europe/London";

function isEuOrUkTimezone(tz: string): boolean {
  if (tz === UK_TZ) return true;
  return EU_TZ_PREFIXES.some((p) => tz.startsWith(p));
}

export class ConsentManager {
  constructor(private readonly opts: ConsentManagerOptions) {}

  private get surface(): Surface {
    return this.opts.surface ?? "top";
  }

  resolve(): Promise<ConsentState> {
    return new Promise<ConsentState>((resolve) => {
      let settled = false;
      let tcString: string | undefined;
      let uspString: string | undefined;

      // One postMessage bridge per resolve(), created lazily only if a direct API
      // isn't reachable, and torn down on finalize so nothing leaks across auctions.
      let bridge: CmpBridge | null | undefined;
      const apiFor = (cfg: CmpBridgeConfig): AnyApi | null => {
        const direct = resolveDirectApi(cfg, this.surface);
        if (direct) return direct;
        if (bridge === undefined) bridge = createCmpBridge();
        const b = bridge;
        return b ? (command, version, cb) => b.call(cfg, command, version, cb) : null;
      };

      const finalize = (state: ConsentState) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (bridge) bridge.dispose();
        resolve(state);
      };

      const timer = setTimeout(() => {
        if (tcString !== undefined || uspString !== undefined) {
          finalize({
            ...(tcString !== undefined ? { tcString } : {}),
            ...(uspString !== undefined ? { uspString } : {}),
            blocked: false,
          });
        } else {
          finalize(this.buildNoCmpState());
        }
      }, this.opts.timeoutMs);

      const tcfApi = apiFor(TCF_BRIDGE) as TcfApi | null;
      if (typeof tcfApi === "function") {
        tcfApi("addEventListener", 2, (data, success) => {
          if (!success || !data) return;
          if (data.eventStatus === "tcloaded" || data.eventStatus === "useractioncomplete") {
            tcString = data.tcString;
            const blocked = data.gdprApplies === true && data.purpose?.consents?.[1] !== true;
            finalize({
              ...(tcString !== undefined ? { tcString } : {}),
              ...(uspString !== undefined ? { uspString } : {}),
              blocked,
            });
          }
        });
      }

      const uspApi = apiFor(USP_BRIDGE) as UspApi | null;
      if (typeof uspApi === "function") {
        uspApi("getUSPData", 1, (data, success) => {
          if (!success || !data) return;
          uspString = data.uspString;
        });
      }
    });
  }

  private buildNoCmpState(): ConsentState {
    const tz = this.opts.timezone ?? this.detectTimezone();
    const inEu = isEuOrUkTimezone(tz);
    return { blocked: inEu };
  }

  private detectTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "UTC";
    }
  }
}
