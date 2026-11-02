import type { ContrastRating, ContrastResult } from "../types";

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 2.x relative luminance of a hex colour. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio (1..21), rounded to 2 decimals. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

export function rateContrast(ratio: number): ContrastRating {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA Large";
  return "Fail";
}

export function contrast(fg: string, bg: string): ContrastResult {
  const ratio = contrastRatio(fg, bg);
  return { ratio, rating: rateContrast(ratio) };
}

/**
 * Pick the most readable text colour for a background. Brand candidates are preferred when they
 * pass AA (4.5:1); otherwise the better of near-white / near-black wins.
 */
export function pickTextColor(bg: string, preferred: string[] = []): string {
  for (const c of preferred) {
    if (contrastRatio(c, bg) >= 4.5) return c;
  }
  return contrastRatio("#FFFFFF", bg) >= contrastRatio("#111111", bg) ? "#FFFFFF" : "#111111";
}
