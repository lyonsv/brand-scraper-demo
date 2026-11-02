import type {
  ButtonStyle,
  ColorPalette,
  ColorRole,
  ColorSource,
  IconAsset,
  ImageAsset,
  LinkStyle,
  LogoAsset,
  LogoSet,
  RawButton,
  RawExtraction,
  Token,
  UiElements,
  WeightMap,
} from "../types";
import { clusterColors, deltaE, parseColor, type ColorEntry } from "./color";
import { assignRoles, toWeightedHex } from "./roles";

export { buildTypography, parseFontFaces } from "./typography";
export { analyzeVoice } from "./voice";

const SOURCE_FACTOR: Record<ColorSource, number> = {
  background: 0.45,
  text: 0.3,
  cta: 0.15,
  border: 0.05,
  variable: 0.05,
};

function normalise(map: WeightMap, source: ColorSource): ColorEntry[] {
  const total = Object.values(map).reduce((s, v) => s + v, 0);
  if (!total) return [];
  return Object.entries(map).map(([color, w]) => ({ color, weight: (w / total) * SOURCE_FACTOR[source] * 1000, source }));
}

export function ctaWeights(buttons: RawButton[]): WeightMap {
  const map: WeightMap = {};
  for (const b of buttons) {
    if (b.bg === "transparent") continue;
    map[b.bg] = (map[b.bg] ?? 0) + Math.max(1, b.score);
  }
  return map;
}

export function variableColors(vars: Record<string, string>): WeightMap {
  const map: WeightMap = {};
  for (const v of Object.values(vars)) {
    if (parseColor(v)) map[v] = (map[v] ?? 0) + 1;
  }
  return map;
}

export function analyzeColors(raw: RawExtraction, samplePoints: number, pixels: BrandMarkPixels = {}): ColorPalette {
  const entries = [
    ...normalise(raw.bgColors, "background"),
    ...normalise(raw.textColors, "text"),
    ...normalise(raw.borderColors, "border"),
    ...normalise(ctaWeights(raw.buttons), "cta"),
    ...normalise(variableColors(raw.cssVars), "variable"),
  ];
  const clusters = clusterColors(entries);
  const { roles, pairs } = assignRoles({
    clusters,
    ctas: raw.buttons.filter((b) => b.bg !== "transparent").map((b) => ({ bg: b.bg, label: b.text })),
    cssVars: raw.cssVars,
    backgrounds: toWeightedHex(raw.bgColors),
    texts: toWeightedHex(raw.textColors),
    borders: toWeightedHex(raw.borderColors),
    marks: brandMarkColors(raw, pixels),
  });
  return {
    roles,
    all: clusters.filter((c) => c.share >= 0.002).slice(0, 24),
    pairs,
    samplePoints,
  };
}

function hexOr(color: string, fallback: string): string {
  return parseColor(color)?.hex ?? fallback;
}

export function toButtonStyle(b: RawButton): ButtonStyle {
  const bg = b.bg === "transparent" ? "transparent" : hexOr(b.bg, "transparent");
  const borderHex = parseColor(b.borderColor);
  return {
    label: b.text,
    background: bg,
    color: hexOr(b.color, "#111111"),
    border: b.borderWidth > 0 && borderHex ? `${b.borderWidth}px solid ${borderHex.hex}` : "none",
    borderRadius: normaliseRadius(b.borderRadius),
    padding: `${Math.round(b.paddingY)}px ${Math.round(b.paddingX)}px`,
    fontSize: b.fontSize,
    fontWeight: b.fontWeight,
    fontFamily: b.fontFamily,
    textTransform: b.textTransform,
    letterSpacing: b.letterSpacing,
    boxShadow: b.boxShadow,
  };
}

/** Drop invisible layers (fully transparent colour or all-zero offsets/blur/spread) from box-shadows. */
export function cleanShadow(value: string): string {
  const layers = value.split(/,(?![^(]*\))/).map((l) => l.trim());
  const visible = layers.filter((l) => {
    if (/rgba?\([^)]*,\s*0\)/.test(l) || /\/\s*0\)/.test(l) || /transparent/.test(l)) return false;
    const nums = l.replace(/\([^)]*\)/g, "").match(/-?[\d.]+px/g) ?? [];
    return nums.some((n) => parseFloat(n) !== 0);
  });
  return visible.join(", ");
}

function cleanShadows(map: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) {
    const c = cleanShadow(k);
    if (c) out[c] = (out[c] ?? 0) + v;
  }
  return out;
}

/** Huge radii ("3.35544e+07px", "50%") are pills; render them as 9999px. */
export function normaliseRadius(r: string): string {
  if (!r) return "0px";
  if (r.includes("%")) return "9999px";
  const n = parseFloat(r);
  if (!Number.isFinite(n)) return "0px";
  return n >= 999 ? "9999px" : `${Math.round(n * 10) / 10}px`;
}

function topTokens(map: Record<string, number>, n: number, sortNumeric: boolean): Token[] {
  const list = Object.entries(map)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
  if (sortNumeric) list.sort((a, b) => parseFloat(a.value) - parseFloat(b.value));
  return list;
}

export function analyzeUi(raw: RawExtraction, roles: ColorRole[]): UiElements {
  const primaryRole = roles.find((r) => r.role === "primary");
  const filled = raw.buttons.filter((b) => b.bg !== "transparent");
  let primary: RawButton | undefined;
  if (primaryRole) {
    primary = filled.find((b) => {
      const p = parseColor(b.bg);
      return p && deltaE(p.hex, primaryRole.hex) < 10;
    });
  }
  primary = primary ?? filled[0] ?? raw.buttons[0];
  const distinct = (b: RawButton) => {
    if (!primary || b === primary) return false;
    if (b.bg === "transparent") return true;
    const a = parseColor(b.bg);
    const p = parseColor(primary.bg);
    return !!a && !!p && deltaE(a.hex, p.hex) >= 10;
  };
  // prefer a real call to action for the secondary button, then any distinct button
  const differentLabel = (b: RawButton) => !primary || b.text.trim().toLowerCase() !== primary.text.trim().toLowerCase();
  const secondary = raw.buttons.find((b) => b.cta && distinct(b) && differentLabel(b)) ?? raw.buttons.find((b) => {
    if (!differentLabel(b)) return false;
    if (!primary || b === primary) return false;
    if (b.bg === "transparent") return true;
    const a = parseColor(b.bg);
    const p = parseColor(primary.bg);
    return !!a && !!p && deltaE(a.hex, p.hex) >= 10;
  });
  const link = raw.links[0];
  const linkStyle: LinkStyle | null = link
    ? { color: hexOr(link.color, "#0000EE"), textDecoration: link.textDecoration, fontWeight: link.fontWeight }
    : null;
  return {
    primaryButton: primary ? toButtonStyle(primary) : null,
    secondaryButton: secondary ? toButtonStyle(secondary) : null,
    link: linkStyle,
    radius: topTokens(raw.radii, 5, true),
    spacing: topTokens(
      Object.fromEntries(Object.entries(raw.spacing).map(([k, v]) => [`${k}px`, v])),
      8,
      true,
    ),
    shadows: topTokens(cleanShadows(raw.shadows), 4, false),
  };
}

/** Paint colours (fill/stroke/stop-color) used in an SVG, with occurrence counts. */
export function svgPaintColors(svg: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of svg.matchAll(/(?:fill|stroke|stop-color)\s*[=:]\s*"?([^";)]+\)?)/gi)) {
    const v = m[1].trim();
    if (/^(none|transparent|url|inherit|currentcolor)/i.test(v)) continue;
    const p = parseColor(v);
    if (p) out[p.hex] = (out[p.hex] ?? 0) + 1;
  }
  return out;
}

/** Classify an SVG's paint colours: all dark neutrals, all light neutrals, or coloured. */
export function svgTone(svg: string): "dark" | "light" | "color" {
  const paints = svgPaintColors(svg);
  if (!Object.keys(paints).length) return "dark"; // SVG default fill is black
  return toneOf(paints);
}

/**
 * Pixel maps may carry a "__bg__<colour>" marker (the opaque corner colour of a captured element).
 * Drop that colour so a logo's white header background doesn't decide its tone.
 */
export function withoutBackground(input: Record<string, number>): Record<string, number> {
  const marker = Object.keys(input).find((k) => k.startsWith("__bg__"));
  const out: Record<string, number> = {};
  const bg = marker ? parseColor(marker.slice(6)) : null;
  for (const [k, v] of Object.entries(input)) {
    if (k.startsWith("__bg__")) continue;
    // with a known background, keep only "ink": pixels clearly lighter/darker than it
    // (drops the background and the anti-aliased fringe around thin strokes)
    if (bg) {
      const p = parseColor(k);
      if (!p || Math.abs(p.oklch.l - bg.oklch.l) < 0.3) continue;
    }
    out[k] = v;
  }
  return out;
}

/** Tone of a weighted colour set (SVG paints or sampled pixels). */
/**
 * Tone of a captured raster logo. Without a clean edge colour (e.g. a translucent sticky header),
 * a single colour covering ≥35% of the capture is treated as the backdrop, not the mark.
 */
export function rasterTone(input: Record<string, number>): "dark" | "light" | "color" {
  if (Object.keys(input).some((k) => k.startsWith("__bg__"))) return toneOf(input);
  const entries = Object.entries(input);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  const [topKey, topW] = [...entries].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (total && topW / total >= 0.35 && topW / total <= 0.9) return toneOf({ ...input, [`__bg__${topKey}`]: 0 });
  return toneOf(input);
}

export function toneOf(input: Record<string, number>): "dark" | "light" | "color" {
  const marked = input;
  const colors = withoutBackground(marked);
  // weighted mean lightness of the mark, plus how much of it is vivid colour
  let total = 0;
  let sumL = 0;
  let vivid = 0;
  for (const [c, w] of Object.entries(colors)) {
    const p = parseColor(c);
    if (!p) continue;
    total += w;
    sumL += p.oklch.l * w;
    if (p.oklch.c >= 0.12) vivid += w;
  }
  if (!total || vivid / total > 0.3) return "color";
  const meanL = sumL / total;
  if (meanL < 0.5) return "dark";
  if (meanL > 0.78) return "light";
  return "color";
}

/** Most-weighted clearly chromatic colour in a weighted set, or null. */
export function dominantChromatic(input: Record<string, number>): string | null {
  const colors = withoutBackground(input);
  const clusters = clusterColors(Object.entries(colors).map(([color, weight]) => ({ color, weight, source: "background" as const })));
  return clusters.find((c) => c.oklch.c >= 0.06 && c.share >= 0.08)?.hex ?? null;
}

export interface BrandMarkPixels {
  /** sampled opaque pixels of the captured logo PNG */
  logo?: Record<string, number> | null;
  /** sampled opaque pixels of the best site icon */
  icon?: Record<string, number> | null;
}

export function brandMarkColors(raw: RawExtraction, px: BrandMarkPixels): Array<{ hex: string; source: "logo" | "icon" }> {
  const marks: Array<{ hex: string; source: "logo" | "icon" }> = [];
  const top = raw.logos?.[0];
  const logoColors = top?.kind === "svg" && top.svg ? svgPaintColors(top.svg) : px.logo ?? null;
  const fromLogo = logoColors ? dominantChromatic(logoColors) : null;
  if (fromLogo) marks.push({ hex: fromLogo, source: "logo" });
  const fromIcon = px.icon ? dominantChromatic(px.icon) : null;
  if (fromIcon) marks.push({ hex: fromIcon, source: "icon" });
  return marks;
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export function buildLogoSet(raw: RawExtraction, pngFallback: string | null, manifestIcons: IconAsset[], pngPixels: Record<string, number> | null = null): LogoSet {
  const logoTone = pngPixels && Object.keys(pngPixels).length ? rasterTone(pngPixels) : undefined;
  const assets: LogoAsset[] = raw.logos.map((l, i) => ({
    kind: l.kind,
    src: l.kind === "svg" && l.svg ? svgToDataUrl(l.svg) : (l.src ?? ""),
    svg: l.svg,
    alt: l.alt,
    width: l.width,
    height: l.height,
    score: l.score,
    reasons: l.reasons,
    tone: l.kind === "svg" && l.svg ? svgTone(l.svg) : i === 0 ? logoTone : undefined,
  }));
  const valid = assets.filter((a) => a.src);
  if (pngFallback && valid[0]) {
    valid.push({
      kind: "png",
      src: pngFallback,
      alt: `${valid[0].alt || "Logo"} (PNG capture)`,
      width: valid[0].width,
      height: valid[0].height,
      score: valid[0].score,
      reasons: ["element screenshot of the top candidate"],
      tone: logoTone,
    });
  }
  const icons: IconAsset[] = [...raw.icons, ...manifestIcons];
  if (raw.ogImage) icons.push({ rel: "og:image", href: raw.ogImage });
  const seen = new Set<string>();
  return {
    primary: valid[0] ?? null,
    // weaker candidates near the top are usually customer-logo walls, not alternate marks
    alternates: valid.slice(1).filter((a) => a.kind === "png" || a.score >= 6),
    icons: icons.filter((i) => (seen.has(i.href) ? false : (seen.add(i.href), true))).slice(0, 10),
  };
}

export function buildImagery(raw: RawExtraction): ImageAsset[] {
  return raw.images.slice(0, 8);
}

const NAME_SPLIT = /\s+[|\-–—:·•]\s+/;

export function brandName(raw: Pick<RawExtraction, "siteName" | "title">, domain: string): string {
  if (raw.siteName && raw.siteName.length <= 40) return raw.siteName;
  const label = domain.replace(/^www\./, "").split(".")[0];
  const parts = raw.title.split(NAME_SPLIT).map((s) => s.trim()).filter(Boolean);
  const match = parts.find((p) => p.toLowerCase().replace(/[^a-z0-9]/g, "").includes(label.toLowerCase()));
  if (match && match.length <= 40) return match;
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (last.length <= 30) return last;
  }
  return label.charAt(0).toUpperCase() + label.slice(1);
}
