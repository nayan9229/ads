import { ConfigError } from "./errors";

export type AdSize = readonly [number, number];

export interface BidderConfig {
  readonly bidder: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface FallbackImageConfig {
  readonly type: "image";
  readonly url: string;
  readonly clickUrl?: string;
}

export interface RefreshConfig {
  readonly intervalSec: number;
  readonly sessionCap?: number;
}

export type BreakpointKey = string;
export type BreakpointSizes = Readonly<Record<BreakpointKey, ReadonlyArray<AdSize>>>;
export type BannerSizes = ReadonlyArray<AdSize> | BreakpointSizes;

export interface BannerMediaType {
  readonly sizes: BannerSizes;
  readonly shrinkToAdSize?: boolean;
  readonly refresh?: RefreshConfig;
}

export interface NativeMediaType {
  readonly template: string;
  readonly requiredAssets: ReadonlyArray<string>;
  readonly refresh?: RefreshConfig;
}

export interface VideoMediaType {
  readonly context?: "instream" | "outstream";
  readonly playerSize?: AdSize;
  readonly mimes?: ReadonlyArray<string>;
  readonly protocols?: ReadonlyArray<number>;
  readonly api?: ReadonlyArray<number>;
  readonly playbackmethod?: ReadonlyArray<number>;
  readonly skip?: 0 | 1;
  readonly delivery?: ReadonlyArray<number>;
  readonly linearity: 1 | 2;
  readonly vastTimeoutMs?: number;
  readonly allowSkip?: boolean;
  readonly refresh?: RefreshConfig;
}

export interface MediaTypes {
  readonly banner?: BannerMediaType;
  readonly native?: NativeMediaType;
  readonly video?: VideoMediaType;
}

export interface ValidatedSlotConfig {
  readonly mediaTypes: MediaTypes;
  readonly bidders: ReadonlyArray<BidderConfig>;
  readonly fallback?: FallbackImageConfig;
  readonly eager?: boolean;
  readonly container?: string;
  readonly adCompleteDelayMs?: number;
}

function isSizeTuple(v: unknown): v is AdSize {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    v[0] > 0 &&
    v[1] > 0
  );
}

const MIN_REFRESH_SEC = 30;

function validateRefresh(
  raw: unknown,
  slotId: string,
  minSec: number = MIN_REFRESH_SEC,
  field = "refresh",
): RefreshConfig | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== "object") {
    throw new ConfigError(`\`${field}\` must be an object`, { slotId, field });
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.intervalSec !== "number" || !Number.isFinite(r.intervalSec)) {
    throw new ConfigError(`\`${field}.intervalSec\` must be a number`, {
      slotId,
      field: `${field}.intervalSec`,
      value: r.intervalSec,
    });
  }
  if (r.intervalSec < minSec) {
    throw new ConfigError(`\`${field}.intervalSec\` must be >= ${minSec}`, {
      slotId,
      field: `${field}.intervalSec`,
      value: r.intervalSec,
    });
  }
  if (r.sessionCap !== undefined) {
    if (typeof r.sessionCap !== "number" || r.sessionCap < 1) {
      throw new ConfigError(`\`${field}.sessionCap\` must be a number >= 1`, {
        slotId,
        field: `${field}.sessionCap`,
        value: r.sessionCap,
      });
    }
  }
  return Object.freeze({
    intervalSec: r.intervalSec,
    ...(typeof r.sessionCap === "number" ? { sessionCap: r.sessionCap } : {}),
  });
}

function validateFallback(raw: unknown, slotId: string): FallbackImageConfig | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== "object") {
    throw new ConfigError("`fallback` must be an object", { slotId, field: "fallback" });
  }
  const f = raw as Record<string, unknown>;
  if (f.type !== "image") {
    throw new ConfigError('`fallback.type` must be "image"', {
      slotId,
      field: "fallback.type",
      value: f.type,
    });
  }
  if (typeof f.url !== "string" || !f.url.startsWith("https://")) {
    throw new ConfigError("`fallback.url` must be an https URL", {
      slotId,
      field: "fallback.url",
      value: f.url,
    });
  }
  if (f.clickUrl !== undefined) {
    if (typeof f.clickUrl !== "string" || !f.clickUrl.startsWith("https://")) {
      throw new ConfigError("`fallback.clickUrl` must be an https URL", {
        slotId,
        field: "fallback.clickUrl",
        value: f.clickUrl,
      });
    }
  }
  return Object.freeze({
    type: "image" as const,
    url: f.url,
    ...(typeof f.clickUrl === "string" ? { clickUrl: f.clickUrl } : {}),
  });
}

function validateBidders(raw: unknown, slotId: string): ReadonlyArray<BidderConfig> {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ConfigError("`bidders` must be a non-empty array", { slotId, field: "bidders" });
  }
  for (const b of raw) {
    if (
      b === null ||
      typeof b !== "object" ||
      typeof (b as BidderConfig).bidder !== "string" ||
      typeof (b as BidderConfig).params !== "object" ||
      (b as BidderConfig).params === null
    ) {
      throw new ConfigError("each bidder must be { bidder: string, params: object }", {
        slotId,
        field: "bidders",
        value: b,
      });
    }
  }
  return raw as ReadonlyArray<BidderConfig>;
}

const BREAKPOINT_KEY_RE = /^\d+(-\d+|\+)$/;

function validateSizeArray(raw: unknown[], slotId: string, field: string): ReadonlyArray<AdSize> {
  if (raw.length === 0) {
    throw new ConfigError(`\`${field}\` must contain at least one [w, h] entry`, {
      slotId,
      field,
    });
  }
  for (const s of raw) {
    if (!isSizeTuple(s)) {
      throw new ConfigError(`\`${field}\` entry must be [number, number]`, {
        slotId,
        field,
        value: s,
      });
    }
  }
  return raw as ReadonlyArray<AdSize>;
}

function freezeSizes(sizes: BannerSizes): BannerSizes {
  if (Array.isArray(sizes)) {
    return sizes.map((s) => Object.freeze([...s]) as unknown as AdSize);
  }
  const out: Record<string, ReadonlyArray<AdSize>> = {};
  for (const [k, v] of Object.entries(sizes as Record<string, ReadonlyArray<AdSize>>)) {
    out[k] = v.map((s) => Object.freeze([...s]) as unknown as AdSize);
  }
  return Object.freeze(out);
}

function validateSizes(
  raw: unknown,
  slotId: string,
  field = "mediaTypes.banner.sizes",
): BannerSizes {
  if (Array.isArray(raw)) {
    return validateSizeArray(raw, slotId, field);
  }
  if (raw !== null && typeof raw === "object") {
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length === 0) {
      throw new ConfigError(`\`${field}\` breakpoint map must have at least one entry`, {
        slotId,
        field,
      });
    }
    const out: Record<string, ReadonlyArray<AdSize>> = {};
    for (const [key, value] of entries) {
      if (!BREAKPOINT_KEY_RE.test(key)) {
        throw new ConfigError(
          `\`${field}\` breakpoint key must match \`<min>-<max>\` or \`<min>+\``,
          { slotId, field, value: key },
        );
      }
      if (!Array.isArray(value)) {
        throw new ConfigError(`\`${field}\` breakpoint value must be an array of [w, h] pairs`, {
          slotId,
          field: `${field}.${key}`,
          value,
        });
      }
      out[key] = validateSizeArray(value, slotId, `${field}.${key}`);
    }
    return Object.freeze(out);
  }
  throw new ConfigError(
    `\`${field}\` must be an array of [w, h] pairs or a breakpoint map object`,
    { slotId, field },
  );
}

function validateBannerMediaType(raw: unknown, slotId: string, minSec?: number): BannerMediaType {
  if (raw === null || typeof raw !== "object") {
    throw new ConfigError("`mediaTypes.banner` must be an object", {
      slotId,
      field: "mediaTypes.banner",
    });
  }
  const b = raw as Record<string, unknown>;
  const sizes = freezeSizes(validateSizes(b.sizes, slotId));
  if (b.shrinkToAdSize !== undefined && typeof b.shrinkToAdSize !== "boolean") {
    throw new ConfigError("`mediaTypes.banner.shrinkToAdSize` must be a boolean", {
      slotId,
      field: "mediaTypes.banner.shrinkToAdSize",
      value: b.shrinkToAdSize,
    });
  }
  const refresh = validateRefresh(b.refresh, slotId, minSec, "mediaTypes.banner.refresh");
  return Object.freeze({
    sizes,
    ...(typeof b.shrinkToAdSize === "boolean" ? { shrinkToAdSize: b.shrinkToAdSize } : {}),
    ...(refresh ? { refresh } : {}),
  });
}

function validateNativeMediaType(raw: unknown, slotId: string, minSec?: number): NativeMediaType {
  if (raw === null || typeof raw !== "object") {
    throw new ConfigError("`mediaTypes.native` must be an object", {
      slotId,
      field: "mediaTypes.native",
    });
  }
  const n = raw as Record<string, unknown>;
  if (typeof n.template !== "string" || n.template.length === 0) {
    throw new ConfigError("`mediaTypes.native.template` must be a non-empty string", {
      slotId,
      field: "mediaTypes.native.template",
    });
  }
  if (!Array.isArray(n.requiredAssets) || n.requiredAssets.some((a) => typeof a !== "string")) {
    throw new ConfigError("`mediaTypes.native.requiredAssets` must be an array of strings", {
      slotId,
      field: "mediaTypes.native.requiredAssets",
    });
  }
  const refresh = validateRefresh(n.refresh, slotId, minSec, "mediaTypes.native.refresh");
  return Object.freeze({
    template: n.template,
    requiredAssets: Object.freeze([...(n.requiredAssets as string[])]),
    ...(refresh ? { refresh } : {}),
  });
}

function validateVideoMediaType(raw: unknown, slotId: string, minSec?: number): VideoMediaType {
  if (raw === null || typeof raw !== "object") {
    throw new ConfigError("`mediaTypes.video` must be an object", {
      slotId,
      field: "mediaTypes.video",
    });
  }
  const v = raw as Record<string, unknown>;
  if (v.context !== undefined && v.context !== "instream" && v.context !== "outstream") {
    throw new ConfigError('`mediaTypes.video.context` must be "instream" or "outstream"', {
      slotId,
      field: "mediaTypes.video.context",
      value: v.context,
    });
  }
  if (v.playerSize !== undefined && !isSizeTuple(v.playerSize)) {
    throw new ConfigError("`mediaTypes.video.playerSize` must be [number, number]", {
      slotId,
      field: "mediaTypes.video.playerSize",
      value: v.playerSize,
    });
  }
  if (v.vastTimeoutMs !== undefined && typeof v.vastTimeoutMs !== "number") {
    throw new ConfigError("`mediaTypes.video.vastTimeoutMs` must be a number", {
      slotId,
      field: "mediaTypes.video.vastTimeoutMs",
      value: v.vastTimeoutMs,
    });
  }
  if (v.allowSkip !== undefined && typeof v.allowSkip !== "boolean") {
    throw new ConfigError("`mediaTypes.video.allowSkip` must be a boolean", {
      slotId,
      field: "mediaTypes.video.allowSkip",
      value: v.allowSkip,
    });
  }
  const refresh = validateRefresh(v.refresh, slotId, minSec, "mediaTypes.video.refresh");
  return Object.freeze({
    ...(v.context !== undefined ? { context: v.context as "instream" | "outstream" } : {}),
    ...(v.playerSize !== undefined
      ? { playerSize: Object.freeze([...(v.playerSize as AdSize)]) as unknown as AdSize }
      : {}),
    ...(Array.isArray(v.mimes) ? { mimes: Object.freeze([...(v.mimes as string[])]) } : {}),
    ...(Array.isArray(v.protocols)
      ? { protocols: Object.freeze([...(v.protocols as number[])]) }
      : {}),
    ...(Array.isArray(v.api) ? { api: Object.freeze([...(v.api as number[])]) } : {}),
    ...(Array.isArray(v.playbackmethod)
      ? { playbackmethod: Object.freeze([...(v.playbackmethod as number[])]) }
      : {}),
    ...(typeof v.skip === "number" ? { skip: v.skip as 0 | 1 } : {}),
    ...(Array.isArray(v.delivery)
      ? { delivery: Object.freeze([...(v.delivery as number[])]) }
      : {}),
    linearity: v.linearity === 2 ? 2 : 1,
    ...(typeof v.vastTimeoutMs === "number" ? { vastTimeoutMs: v.vastTimeoutMs } : {}),
    ...(typeof v.allowSkip === "boolean" ? { allowSkip: v.allowSkip } : {}),
    ...(refresh ? { refresh } : {}),
  });
}

function validateMediaTypes(raw: unknown, slotId: string, minSec?: number): MediaTypes {
  if (raw === null || typeof raw !== "object") {
    throw new ConfigError("`mediaTypes` must be an object", { slotId, field: "mediaTypes" });
  }
  const m = raw as Record<string, unknown>;
  const out: { -readonly [K in keyof MediaTypes]: MediaTypes[K] } = {};
  if (m.banner !== undefined) out.banner = validateBannerMediaType(m.banner, slotId, minSec);
  if (m.native !== undefined) out.native = validateNativeMediaType(m.native, slotId, minSec);
  if (m.video !== undefined) out.video = validateVideoMediaType(m.video, slotId, minSec);
  if (!out.banner && !out.native && !out.video) {
    throw new ConfigError(
      "`mediaTypes` must declare at least one of `banner`, `native`, or `video`",
      { slotId, field: "mediaTypes" },
    );
  }
  return Object.freeze(out) as MediaTypes;
}

export interface ConfigRegistryOptions {
  readonly minRefreshIntervalSec?: number;
}

export class ConfigRegistry {
  private readonly store = new Map<string, ValidatedSlotConfig>();

  constructor(private readonly opts: ConfigRegistryOptions = {}) {}

  get(slotId: string): ValidatedSlotConfig | undefined {
    return this.store.get(slotId);
  }

  register(slotId: string, raw: unknown): ValidatedSlotConfig {
    if (raw === null || typeof raw !== "object") {
      throw new ConfigError("config must be an object", { slotId });
    }
    const r = raw as Record<string, unknown>;

    const mediaTypes = validateMediaTypes(r.mediaTypes, slotId, this.opts.minRefreshIntervalSec);

    const bidders = validateBidders(r.bidders, slotId).map((b) =>
      Object.freeze({ bidder: b.bidder, params: Object.freeze({ ...b.params }) }),
    );

    const fallback = validateFallback(r.fallback, slotId);

    if (r.eager !== undefined && typeof r.eager !== "boolean") {
      throw new ConfigError("`eager` must be a boolean", {
        slotId,
        field: "eager",
        value: r.eager,
      });
    }

    if (r.container !== undefined) {
      if (typeof r.container !== "string" || r.container.length === 0) {
        throw new ConfigError("`container` must be a non-empty string element ID", {
          slotId,
          field: "container",
          value: r.container,
        });
      }
    }

    if (r.adCompleteDelayMs !== undefined) {
      if (
        typeof r.adCompleteDelayMs !== "number" ||
        !Number.isFinite(r.adCompleteDelayMs) ||
        r.adCompleteDelayMs < 0
      ) {
        throw new ConfigError("`adCompleteDelayMs` must be a non-negative number", {
          slotId,
          field: "adCompleteDelayMs",
          value: r.adCompleteDelayMs,
        });
      }
    }

    const validated: ValidatedSlotConfig = Object.freeze({
      mediaTypes,
      bidders,
      ...(fallback ? { fallback } : {}),
      ...(typeof r.eager === "boolean" ? { eager: r.eager } : {}),
      ...(typeof r.container === "string" ? { container: r.container } : {}),
      ...(typeof r.adCompleteDelayMs === "number" ? { adCompleteDelayMs: r.adCompleteDelayMs } : {}),
    });
    this.store.set(slotId, validated);
    return validated;
  }
}
