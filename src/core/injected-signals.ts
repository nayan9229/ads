import { Eid } from "./identity-signal-merger";

// Publisher-injected signals (#1 identity + #5 contextual, D65/ADR-0008).
// A cross-origin safeframe cannot read the publisher's cookies or top-page URL,
// so the publisher hands identity + context IN via a channel their GAM creative
// type supports. The SDK reads them here and feeds ortb2.

export interface InjectedSite {
  readonly page?: string;
  readonly cat?: ReadonlyArray<string>;
  readonly keywords?: string;
  readonly content?: { readonly keywords?: string; readonly language?: string };
}

export interface InjectedSignals {
  readonly eids: ReadonlyArray<Eid>;
  readonly buyeruid?: string;
  readonly site?: InjectedSite;
}

// Named shortcut → canonical OpenRTB eid source.
const SHORTCUT_SOURCES: Readonly<Record<string, string>> = {
  uid2: "uidapi.com",
  id5: "id5-sync.com",
  ramp: "liveramp.com",
};

// Flat, string-ish bag as it arrives from any channel before typed parsing.
interface RawBag {
  eids?: unknown; // base64url JSON (URL param) OR an array (global/meta)
  uid2?: unknown;
  id5?: unknown;
  ramp?: unknown;
  buyeruid?: unknown;
  page?: unknown;
  cat?: unknown; // CSV string OR array
  keywords?: unknown;
  content?: unknown; // object
  lang?: unknown;
}

function base64UrlDecode(input: string): string | null {
  try {
    let s = input.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4 !== 0) s += "=";
    if (typeof atob === "function") return atob(s);
    // Node fallback (tests / SSR)
    return Buffer.from(s, "base64").toString("binary");
  } catch {
    return null;
  }
}

function asEid(v: unknown): Eid | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { source?: unknown; uids?: unknown };
  if (typeof o.source !== "string" || o.source.length === 0) return null;
  if (!Array.isArray(o.uids)) return null;
  const uids = o.uids
    .map((u) => (u && typeof (u as { id?: unknown }).id === "string" ? { id: (u as { id: string }).id } : null))
    .filter((u): u is { id: string } => u !== null);
  if (uids.length === 0) return null;
  return { source: o.source, uids };
}

function parseEidsField(raw: unknown): Eid[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    const json = base64UrlDecode(raw);
    if (json === null) return [];
    try {
      arr = JSON.parse(json);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map(asEid).filter((e): e is Eid => e !== null);
}

function parseIdentity(bag: RawBag): { eids: Eid[]; buyeruid?: string } {
  const bySource = new Map<string, Eid>();
  // Named shortcuts first (explicit), then the raw eids array; first wins per source.
  for (const [key, source] of Object.entries(SHORTCUT_SOURCES)) {
    const id = (bag as Record<string, unknown>)[key];
    if (typeof id === "string" && id.length > 0 && !bySource.has(source)) {
      bySource.set(source, { source, uids: [{ id }] });
    }
  }
  for (const eid of parseEidsField(bag.eids)) {
    if (!bySource.has(eid.source)) bySource.set(eid.source, eid);
  }
  const out: { eids: Eid[]; buyeruid?: string } = { eids: [...bySource.values()] };
  if (typeof bag.buyeruid === "string" && bag.buyeruid.length > 0) out.buyeruid = bag.buyeruid;
  return out;
}

function parseSite(bag: RawBag): InjectedSite | undefined {
  const site: {
    page?: string;
    cat?: string[];
    keywords?: string;
    content?: { keywords?: string; language?: string };
  } = {};
  if (typeof bag.page === "string" && bag.page.length > 0) site.page = bag.page;
  if (Array.isArray(bag.cat)) {
    const cat = bag.cat.filter((c): c is string => typeof c === "string" && c.length > 0);
    if (cat.length > 0) site.cat = cat;
  } else if (typeof bag.cat === "string" && bag.cat.length > 0) {
    site.cat = bag.cat.split(",").map((c) => c.trim()).filter((c) => c.length > 0);
  }
  if (typeof bag.keywords === "string" && bag.keywords.length > 0) site.keywords = bag.keywords;
  const content: { keywords?: string; language?: string } = {};
  if (bag.content && typeof bag.content === "object") {
    const c = bag.content as { keywords?: unknown; language?: unknown };
    if (typeof c.keywords === "string") content.keywords = c.keywords;
    if (typeof c.language === "string") content.language = c.language;
  }
  if (typeof bag.lang === "string" && bag.lang.length > 0 && content.language === undefined) {
    content.language = bag.lang;
  }
  if (Object.keys(content).length > 0) site.content = content;
  return Object.keys(site).length > 0 ? site : undefined;
}

function fromSafeFrameMeta(win: SignalWindow): RawBag | null {
  try {
    const meta = win.$sf?.ext?.meta;
    const obj = typeof meta === "function" ? meta() : undefined;
    const adw = obj && typeof obj === "object" ? (obj as { adw?: unknown }).adw : undefined;
    return adw && typeof adw === "object" ? (adw as RawBag) : null;
  } catch {
    return null;
  }
}

function fromGlobal(win: SignalWindow): RawBag | null {
  const g = win.AdWrapperIdentity;
  return g && typeof g === "object" ? (g as RawBag) : null;
}

function fromScriptUrl(win: SignalWindow): RawBag | null {
  try {
    const src = win.document?.currentScript?.src;
    if (typeof src !== "string" || src.indexOf("?") === -1) return null;
    const params = new URLSearchParams(src.slice(src.indexOf("?") + 1));
    const bag: Record<string, string> = {};
    for (const [k, v] of params) bag[k] = v;
    return bag as RawBag;
  } catch {
    return null;
  }
}

interface SignalWindow {
  readonly $sf?: { readonly ext?: { readonly meta?: () => unknown } };
  readonly AdWrapperIdentity?: unknown;
  readonly document?: { readonly currentScript?: { readonly src?: string } | null };
}

// Read publisher-injected signals. Precedence: $sf.ext.meta() → window.AdWrapperIdentity
// → gen_ad.min.js script-URL params. Earlier sources win per field. Never throws.
export function readInjectedSignals(
  win: unknown = typeof window !== "undefined" ? window : undefined,
): InjectedSignals {
  if (!win) return { eids: [] };
  const w = win as SignalWindow;
  const layers = [fromSafeFrameMeta(w), fromGlobal(w), fromScriptUrl(w)];
  const bag: RawBag = {};
  // First non-undefined value per key wins (precedence = layer order).
  for (const layer of layers) {
    if (!layer) continue;
    for (const key of Object.keys(layer) as (keyof RawBag)[]) {
      if (bag[key] === undefined && (layer as RawBag)[key] !== undefined) {
        (bag as Record<string, unknown>)[key] = (layer as RawBag)[key];
      }
    }
  }

  const identity = parseIdentity(bag);
  const site = parseSite(bag);
  const out: { eids: Eid[]; buyeruid?: string; site?: InjectedSite } = { eids: identity.eids };
  if (identity.buyeruid !== undefined) out.buyeruid = identity.buyeruid;
  if (site !== undefined) out.site = site;
  return out;
}
