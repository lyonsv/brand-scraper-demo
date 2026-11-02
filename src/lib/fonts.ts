// Client-safe helpers for previewing extracted fonts.
import type { FontFamilyInfo, Typography } from "./types";

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|blinkmacsystemfont)$/i;

/** Alias under which we register a site's web font, so a locally installed copy can't shadow it. */
export function previewFamily(family: string): string {
  return `bs ${family}`;
}

export function proxiedFontUrl(url: string): string {
  return `/api/font?url=${encodeURIComponent(url)}`;
}

function cssString(s: string): string {
  return `"${s.replace(/["\\]/g, "")}"`;
}

export function fontFaceCss(families: FontFamilyInfo[]): string {
  const rules: string[] = [];
  for (const f of families) {
    for (const src of f.sources) {
      const format = src.format ? ` format(${cssString(src.format)})` : "";
      const weight = /^[\d\s]+$/.test(src.weight) ? src.weight : "100 900";
      const style = src.style === "italic" || src.style === "oblique" ? src.style : "normal";
      rules.push(
        `@font-face{font-family:${cssString(previewFamily(f.family))};src:url(${cssString(proxiedFontUrl(src.url))})${format};font-weight:${weight};font-style:${style};font-display:swap;}`,
      );
    }
  }
  return rules.join("\n");
}

/** A CSS font-family stack that prefers the proxied web font, then the site's own stack. */
export function familyStack(f: FontFamilyInfo | undefined, fallback = "system-ui, sans-serif"): string {
  if (!f) return fallback;
  const own = f.stack
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
    .map((s) => (GENERIC.test(s) ? s : cssString(s)));
  const parts = f.sources.length ? [cssString(previewFamily(f.family)), ...own] : own;
  return [...parts, fallback].join(", ");
}

export function familyFor(t: Typography, role: "heading" | "body"): FontFamilyInfo | undefined {
  const name = role === "heading" ? t.headingFamily : t.bodyFamily;
  return t.families.find((f) => f.family === name) ?? t.families[0];
}

/** Turn "100 900" or "400" into a few concrete weights worth previewing. */
export function previewWeights(weights: string[]): number[] {
  const out = new Set<number>();
  for (const w of weights) {
    const nums = w.split(/\s+/).map(Number).filter((n) => Number.isFinite(n));
    if (nums.length === 2) {
      for (const n of [400, 500, 600, 700]) if (n >= nums[0] && n <= nums[1]) out.add(n);
    } else if (nums.length === 1) out.add(nums[0]);
  }
  if (!out.size) out.add(400);
  return [...out].sort((a, b) => a - b).slice(0, 5);
}

/** "400" → "400"; "1 1000" (variable font axis range) → "1–1000 (variable)". */
export function formatWeight(w: string): string {
  const nums = w.trim().split(/\s+/);
  return nums.length === 2 ? `${nums[0]}–${nums[1]} (variable)` : w;
}
