import {
  useMode,
  modeA98,
  modeHsl,
  modeHwb,
  modeLab,
  modeLab65,
  modeLch,
  modeLrgb,
  modeOklab,
  modeOklch,
  modeP3,
  modeProphoto,
  modeRec2020,
  modeRgb,
  modeXyz50,
  modeXyz65,
  differenceCiede2000,
  formatHex,
  parse,
} from "culori/fn";
import type { ColorCluster, ColorSource, Oklch } from "../types";

// Register the colour spaces Chrome can hand back from getComputedStyle.
useMode(modeRgb);
useMode(modeLrgb);
useMode(modeXyz65);
useMode(modeXyz50);
useMode(modeLab);
useMode(modeLab65);
useMode(modeLch);
useMode(modeOklab);
useMode(modeHsl);
useMode(modeHwb);
useMode(modeP3);
useMode(modeRec2020);
useMode(modeA98);
useMode(modeProphoto);
const toOklchMode = useMode(modeOklch);

const ciede = differenceCiede2000();

/** chroma below this counts as neutral (grey / black / white) */
export const NEUTRAL_CHROMA = 0.035;
/** ΔE2000 below this merges two colours into one cluster */
export const CLUSTER_DELTA_E = 6;

export interface ParsedColor {
  hex: string;
  oklch: Oklch;
  alpha: number;
}

const cache = new Map<string, ParsedColor | null>();

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Parse any CSS colour string into hex + OKLCH. Returns null for unparsable or near-transparent colours. */
export function parseColor(input: string): ParsedColor | null {
  const key = input.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;
  let result: ParsedColor | null = null;
  const color = parse(key);
  if (color) {
    const alpha = color.alpha ?? 1;
    if (alpha >= 0.05) {
      const ok = toOklchMode(color);
      const hex = formatHex(color);
      if (ok && hex) {
        result = {
          hex: hex.toUpperCase(),
          oklch: { l: round(ok.l, 3), c: round(ok.c ?? 0, 3), h: round(ok.h ?? 0, 1) },
          alpha,
        };
      }
    }
  }
  cache.set(key, result);
  return result;
}

export function isNeutral(c: Oklch): boolean {
  return c.c < NEUTRAL_CHROMA;
}

export function deltaE(a: string, b: string): number {
  return ciede(a, b);
}

/** Smallest angle between two hues, in degrees (0..180). */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function formatOklch(c: Oklch): string {
  return `oklch(${(c.l * 100).toFixed(1)}% ${c.c.toFixed(3)} ${c.h.toFixed(1)})`;
}

export interface ColorEntry {
  color: string;
  weight: number;
  source: ColorSource;
}

/**
 * Greedy area-weighted clustering. Entries are sorted by weight; each one joins the first
 * existing cluster whose representative is within `threshold` ΔE2000, otherwise it starts a
 * new cluster. The representative is the heaviest member (so the hex is a real site colour).
 */
export function clusterColors(entries: ColorEntry[], threshold = CLUSTER_DELTA_E): ColorCluster[] {
  // merge identical hexes first
  const byHex = new Map<string, { parsed: ParsedColor; weight: number; sources: Partial<Record<ColorSource, number>> }>();
  for (const e of entries) {
    if (!(e.weight > 0)) continue;
    const parsed = parseColor(e.color);
    if (!parsed) continue;
    const w = e.weight * Math.min(1, parsed.alpha);
    const cur = byHex.get(parsed.hex) ?? { parsed, weight: 0, sources: {} };
    cur.weight += w;
    cur.sources[e.source] = (cur.sources[e.source] ?? 0) + w;
    byHex.set(parsed.hex, cur);
  }
  const sorted = [...byHex.values()].sort((a, b) => b.weight - a.weight);
  const clusters: ColorCluster[] = [];
  for (const item of sorted) {
    const target = clusters.find((c) => deltaE(c.hex, item.parsed.hex) < threshold);
    if (target) {
      target.weight += item.weight;
      target.members.push(item.parsed.hex);
      for (const [k, v] of Object.entries(item.sources) as Array<[ColorSource, number]>) {
        target.sources[k] = (target.sources[k] ?? 0) + v;
      }
    } else {
      clusters.push({
        hex: item.parsed.hex,
        oklch: item.parsed.oklch,
        weight: item.weight,
        share: 0,
        chromatic: !isNeutral(item.parsed.oklch),
        sources: { ...item.sources },
        members: [item.parsed.hex],
      });
    }
  }
  const total = clusters.reduce((s, c) => s + c.weight, 0) || 1;
  for (const c of clusters) {
    c.share = c.weight / total;
    c.weight = round(c.weight, 2);
  }
  return clusters.sort((a, b) => b.weight - a.weight);
}

/** Find the cluster nearest to a colour (within threshold), or null. */
export function findCluster(clusters: ColorCluster[], color: string, threshold = CLUSTER_DELTA_E): ColorCluster | null {
  const parsed = parseColor(color);
  if (!parsed) return null;
  let best: ColorCluster | null = null;
  let bestD = Infinity;
  for (const c of clusters) {
    if (c.members.includes(parsed.hex)) return c;
    const d = deltaE(c.hex, parsed.hex);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return bestD < threshold ? best : null;
}

/** Shift lightness in OKLCH and return a hex (used for derived roles such as surface). */
export function adjustLightness(hex: string, delta: number): string {
  const p = parseColor(hex);
  if (!p) return hex;
  const l = Math.max(0, Math.min(1, p.oklch.l + delta));
  const out = formatHex({ mode: "oklch", l, c: p.oklch.c, h: p.oklch.h });
  return (out ?? hex).toUpperCase();
}
