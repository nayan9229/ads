export interface NewRelicConfig {
  readonly licenseKey: string;
  readonly applicationID: string;
  readonly accountID?: string;
  readonly trustKey?: string;
  readonly beacon?: string;
  readonly errorBeacon?: string;
  readonly agentSrc?: string;
  readonly sampleRate?: number;
  readonly enabled?: boolean;
}

interface NewRelicAgent {
  addPageAction?: (name: string, attrs?: Record<string, unknown>) => void;
}

interface NREUMConfig {
  loader_config?: Record<string, unknown>;
  info?: Record<string, unknown>;
  init?: Record<string, unknown>;
}

type NRWindow = Window & {
  newrelic?: NewRelicAgent;
  NREUM?: NREUMConfig;
};

export type ScriptLoader = (src: string, win: NRWindow) => Promise<void>;

export interface NewRelicSinkOptions {
  readonly config: NewRelicConfig;
  readonly sessionId: string;
  readonly rng?: () => number;
  readonly window?: NRWindow;
  readonly scriptLoader?: ScriptLoader;
  readonly queueCap?: number;
}

const DEFAULT_AGENT_SRC = "https://js-agent.newrelic.com/nr-loader-spa-current.min.js";
const DEFAULT_BEACON = "bam.nr-data.net";
const DEFAULT_QUEUE_CAP = 50;
const EVENT_NAME_PREFIX = "adwrapper_";
const MAX_MESSAGE_LEN = 200;

type ActionEntry = { kind: "action"; name: string; attrs: Record<string, unknown> };
type QueueEntry = ActionEntry;

export const NR_ATTR_ALLOWLIST: Readonly<Record<string, ReadonlyArray<string>>> = Object.freeze({
  adRenderSuccess: ["slotId", "bidder", "cpm", "size", "mediaType"],
  adRenderFail: ["slotId", "reason"],
  noFill: ["slotId"],
  viewable: ["slotId"],
  refresh: ["slotId", "count"],
  refresh_cap_reached: ["slotId", "cap"],
  environment_detected: ["environment"],
  bidder_config: ["slotId", "bidder_count", "bidder_names", "bidders_json"],
});

export class NewRelicSink {
  private agent: NewRelicAgent | null = null;
  private queue: QueueEntry[] = [];
  private disposed = false;
  private readonly queueCap: number;
  private readonly sampledIn: boolean;
  private readonly sessionId: string;
  private readonly win: NRWindow;

  constructor(opts: NewRelicSinkOptions) {
    this.win = opts.window ?? (window as NRWindow);
    this.sessionId = opts.sessionId;
    this.queueCap = opts.queueCap ?? DEFAULT_QUEUE_CAP;

    const sampleRate = opts.config.sampleRate ?? 1.0;
    const rng = opts.rng ?? Math.random;
    if (sampleRate >= 1) this.sampledIn = true;
    else if (sampleRate <= 0) this.sampledIn = false;
    else this.sampledIn = rng() < sampleRate;

    const existing = this.win.newrelic;
    if (existing && typeof existing.addPageAction === "function") {
      this.agent = existing;
      return;
    }

    if (opts.config.enabled === false) return;

    this.seedNREUM(opts.config);
    const src = opts.config.agentSrc ?? DEFAULT_AGENT_SRC;
    const loader = opts.scriptLoader ?? defaultScriptLoader;
    loader(src, this.win).then(
      () => {
        if (this.disposed) return;
        const agent = this.win.newrelic;
        if (agent) {
          this.agent = agent;
          this.flush();
        } else {
          this.queue = [];
        }
      },
      () => {
        this.queue = [];
      },
    );
  }

  emit(eventName: string, payload: Record<string, unknown>): void {
    if (this.disposed) return;
    if (!this.sampledIn) return;
    const allowlist = NR_ATTR_ALLOWLIST[eventName];
    if (!allowlist) return;
    const attrs = this.buildAttrs(payload, allowlist);
    const entry: ActionEntry = {
      kind: "action",
      name: EVENT_NAME_PREFIX + eventName,
      attrs,
    };
    if (this.agent && typeof this.agent.addPageAction === "function") {
      this.agent.addPageAction(entry.name, entry.attrs);
    } else {
      this.enqueue(entry);
    }
  }

  emitError(payload: Record<string, unknown>): void {
    if (this.disposed) return;
    const code = stringifyOr(payload["code"], "E_UNKNOWN");
    const rawMessage = stringifyOr(payload["message"], "unknown error");
    const message = rawMessage.length > MAX_MESSAGE_LEN ? rawMessage.slice(0, MAX_MESSAGE_LEN) : rawMessage;

    const attrs: Record<string, unknown> = {
      sessionId: this.sessionId,
      code,
      message,
    };
    const ctx = payload["context"];
    if (ctx && typeof ctx === "object") {
      const slotId = (ctx as Record<string, unknown>)["slotId"];
      if (typeof slotId === "string") attrs["slotId"] = slotId;
    }
    if (typeof payload["slotId"] === "string") attrs["slotId"] = payload["slotId"];

    const entry: ActionEntry = {
      kind: "action",
      name: EVENT_NAME_PREFIX + "error",
      attrs,
    };
    if (this.agent && typeof this.agent.addPageAction === "function") {
      this.agent.addPageAction(entry.name, entry.attrs);
    } else {
      this.enqueue(entry);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
    this.agent = null;
  }

  private buildAttrs(payload: Record<string, unknown>, allowlist: ReadonlyArray<string>): Record<string, unknown> {
    const out: Record<string, unknown> = { sessionId: this.sessionId };
    for (const key of allowlist) {
      const val = payload[key];
      if (val === undefined || val === null) continue;
      if (key === "cpm" && typeof val === "number" && Number.isFinite(val)) {
        out["cpm_bucket"] = Math.floor(val * 4) / 4;
        continue;
      }
      if (key === "size") {
        out[key] = formatSize(val);
        continue;
      }
      if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
        out[key] = val;
      }
    }
    return out;
  }

  private enqueue(entry: QueueEntry): void {
    if (this.queue.length >= this.queueCap) {
      this.queue.shift();
    }
    this.queue.push(entry);
  }

  private flush(): void {
    const agent = this.agent;
    if (!agent || typeof agent.addPageAction !== "function") return;
    const pending = this.queue;
    this.queue = [];
    for (const entry of pending) {
      agent.addPageAction(entry.name, entry.attrs);
    }
  }

  private seedNREUM(cfg: NewRelicConfig): void {
    if (this.win.NREUM) return;
    const beacon = cfg.beacon ?? DEFAULT_BEACON;
    const errorBeacon = cfg.errorBeacon ?? beacon;
    const info: Record<string, unknown> = {
      beacon,
      errorBeacon,
      licenseKey: cfg.licenseKey,
      applicationID: cfg.applicationID,
      sa: 1,
    };
    const loader_config: Record<string, unknown> = {
      licenseKey: cfg.licenseKey,
      applicationID: cfg.applicationID,
    };
    if (cfg.accountID !== undefined) loader_config["accountID"] = cfg.accountID;
    if (cfg.trustKey !== undefined) loader_config["trustKey"] = cfg.trustKey;

    // Disable every NR auto-feature so the agent forwards only the
    // adwrapper_* PageActions emitted by this sink. No page-view event,
    // no AJAX, no SPA, no JS errors, no session trace/replay, no timings.
    const init: Record<string, unknown> = {
      ajax: { enabled: false, deny_list: ["*"] },
      jserrors: { enabled: false },
      metrics: { enabled: false },
      page_action: { enabled: true, harvestTimeSeconds: 30 },
      page_view_event: { enabled: false },
      page_view_timing: { enabled: false },
      session_replay: { enabled: false },
      session_trace: { enabled: false },
      spa: { enabled: false },
      distributed_tracing: { enabled: false },
      privacy: { cookies_enabled: false },
    };

    this.win.NREUM = { loader_config, info, init };
  }
}

function stringifyOr(val: unknown, fallback: string): string {
  if (typeof val === "string" && val.length > 0) return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return fallback;
}

function formatSize(val: unknown): string {
  if (Array.isArray(val) && val.length === 2 && typeof val[0] === "number" && typeof val[1] === "number") {
    return val[0] + "x" + val[1];
  }
  if (typeof val === "string") return val;
  return "";
}

const defaultScriptLoader: ScriptLoader = (src, win) =>
  new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("no document"));
      return;
    }
    const existing = document.querySelector('script[data-adwrapper-nr-loader="true"]');
    if (existing) {
      if ((win as NRWindow).newrelic) {
        resolve();
      } else {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("nr loader failed")), { once: true });
      }
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.setAttribute("data-adwrapper-nr-loader", "true");
    el.addEventListener("load", () => resolve(), { once: true });
    el.addEventListener("error", () => reject(new Error("nr loader failed")), { once: true });
    document.head.appendChild(el);
  });
