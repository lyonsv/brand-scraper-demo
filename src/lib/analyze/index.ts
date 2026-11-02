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

export function analyzeColors(raw: RawExtraction, samplePoints: number): ColorPalette {
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
  const secondary = raw.buttons.find((b) => {
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

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export function buildLogoSet(raw: RawExtraction, pngFallback: string | null, manifestIcons: IconAsset[]): LogoSet {
  const assets: LogoAsset[] = raw.logos.map((l) => ({
    kind: l.kind,
    src: l.kind === "svg" && l.svg ? svgToDataUrl(l.svg) : (l.src ?? ""),
    svg: l.svg,
    alt: l.alt,
    width: l.width,
    height: l.height,
    score: l.score,
    reasons: l.reasons,
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
    });
  }
  const icons: IconAsset[] = [...raw.icons, ...manifestIcons];
  if (raw.ogImage) icons.push({ rel: "og:image", href: raw.ogImage });
  const seen = new Set<string>();
  return {
    primary: valid[0] ?? null,
    alternates: valid.slice(1),
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
