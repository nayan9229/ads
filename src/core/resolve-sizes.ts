import { AdSize, BannerSizes, BreakpointSizes } from "./config-registry";

interface Range {
  readonly min: number;
  readonly max: number;
}

function parseKey(key: string): Range | null {
  const plus = key.match(/^(\d+)\+$/);
  if (plus) return { min: Number(plus[1]), max: Infinity };
  const range = key.match(/^(\d+)-(\d+)$/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  return null;
}

export function resolveSizesForViewport(
  sizes: BannerSizes,
  innerWidth: number,
): ReadonlyArray<AdSize> {
  if (Array.isArray(sizes)) return sizes;

  const map = sizes as BreakpointSizes;
  for (const [key, set] of Object.entries(map)) {
    const range = parseKey(key);
    if (range && innerWidth >= range.min && innerWidth <= range.max) {
      return set;
    }
  }
  // Fallback: pick set whose lower bound is closest to but below innerWidth.
  let chosen: ReadonlyArray<AdSize> = [];
  let bestMin = -1;
  for (const [key, set] of Object.entries(map)) {
    const range = parseKey(key);
    if (!range) continue;
    if (range.min <= innerWidth && range.min > bestMin) {
      bestMin = range.min;
      chosen = set;
    }
  }
  return chosen;
}
