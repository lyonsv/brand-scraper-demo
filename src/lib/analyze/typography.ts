import type { FontFamilyInfo, FontSource, RawFontFace, RawTypeSample, TypeScaleEntry, Typography } from "../types";

const SYSTEM_FAMILIES = new Set(
  [
    "-apple-system",
    "blinkmacsystemfont",
    "system-ui",
    "ui-sans-serif",
    "ui-serif",
    "ui-monospace",
    "segoe ui",
    "helvetica",
    "helvetica neue",
    "arial",
    "sans-serif",
    "serif",
    "monospace",
    "times",
    "times new roman",
    "georgia",
    "verdana",
    "tahoma",
    "courier",
    "courier new",
    "apple color emoji",
    "segoe ui emoji",
    "segoe ui symbol",
    "noto color emoji",
    "menlo",
    "monaco",
    "consolas",
    "sf pro",
    "sf pro text",
    "sf pro display",
  ].map((s) => s.toLowerCase()),
);

export function cleanFamily(name: string): string {
  return name.trim().replace(/^["']|["']$/g, "").trim();
}

/** First family in a CSS font-family stack. */
export function primaryFamily(stack: string): string {
  return cleanFamily(stack.split(",")[0] ?? "");
}

export function isSystemFamily(name: string): boolean {
  return SYSTEM_FAMILIES.has(cleanFamily(name).toLowerCase());
}

/** Next.js/Google-font style hashed names ("__Inter_d65c78", "__Inter_Fallback_x") → readable. */
export function prettyFamily(name: string): string {
  const m = name.match(/^__([A-Za-z0-9_]+?)_(?:Fallback_)?[a-f0-9]{5,}$/);
  if (m) return m[1].replace(/_/g, " ");
  return name;
}

export interface ParsedFontFace {
  family: string;
  weight: string;
  style: string;
  sources: Array<{ url: string; format: string }>;
}

/** Parse @font-face blocks out of a stylesheet's text, resolving url()s against the sheet URL. */
export function parseFontFaces(css: string, baseUrl: string): ParsedFontFace[] {
  const out: ParsedFontFace[] = [];
  const re = /@font-face\s*{([^}]*)}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const body = m[1];
    const family = body.match(/font-family\s*:\s*([^;]+)/i)?.[1];
    const src = body.match(/src\s*:\s*([^;]+)/i)?.[1];
    if (!family || !src) continue;
    const weight = body.match(/font-weight\s*:\s*([^;]+)/i)?.[1]?.trim() ?? "400";
    const style = body.match(/font-style\s*:\s*([^;]+)/i)?.[1]?.trim() ?? "normal";
    const sources: Array<{ url: string; format: string }> = [];
    const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)(?:\s*format\(\s*['"]?([^'")]+)['"]?\s*\))?/gi;
    let u: RegExpExecArray | null;
    while ((u = urlRe.exec(src))) {
      if (u[2].startsWith("data:")) continue;
      try {
        const abs = new URL(u[2], baseUrl).href;
        const format = u[3] ?? (abs.match(/\.(woff2|woff|ttf|otf)(\?|$)/i)?.[1] ?? "").toLowerCase();
        sources.push({ url: abs, format: format === "ttf" ? "truetype" : format === "otf" ? "opentype" : format });
      } catch {
        /* ignore bad urls */
      }
    }
    if (sources.length) out.push({ family: cleanFamily(family), weight, style, sources });
  }
  return out;
}

const FORMAT_RANK: Record<string, number> = { woff2: 0, woff: 1, truetype: 2, opentype: 3 };

function bestSource(sources: Array<{ url: string; format: string }>) {
  return [...sources].sort((a, b) => (FORMAT_RANK[a.format] ?? 9) - (FORMAT_RANK[b.format] ?? 9))[0];
}

const TAG_ORDER = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "small"];

/** Most common style per tag, ordered h1 → small. */
export function buildTypeScale(samples: RawTypeSample[]): TypeScaleEntry[] {
  const best = new Map<string, RawTypeSample>();
  for (const s of samples) {
    const cur = best.get(s.tag);
    if (!cur || s.count > cur.count) best.set(s.tag, s);
  }
  return TAG_ORDER.filter((t) => best.has(t)).map((t) => {
    const s = best.get(t)!;
    return {
      tag: t,
      fontSize: Math.round(s.fontSize * 10) / 10,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      family: prettyFamily(primaryFamily(s.fontFamily)),
      sample: s.text,
    };
  });
}

/** Geometric mean of consecutive size ratios across distinct heading/body sizes. */
export function scaleRatio(entries: TypeScaleEntry[]): number | null {
  const sizes = [...new Set(entries.filter((e) => e.tag !== "small").map((e) => e.fontSize))]
    .filter((n) => n > 0)
    .sort((a, b) => b - a);
  if (sizes.length < 2) return null;
  const overall = sizes[0] / sizes[sizes.length - 1];
  const ratio = overall ** (1 / (sizes.length - 1));
  return Math.round(ratio * 100) / 100;
}

export interface TypographyInput {
  families: Record<string, number>;
  headingFamilies: Record<string, number>;
  fontFaces: RawFontFace[];
  typeSamples: RawTypeSample[];
  parsedFaces: ParsedFontFace[];
}

export function buildTypography(input: TypographyInput): Typography {
  // aggregate weights by primary family
  const usage = new Map<string, { weight: number; stack: string }>();
  for (const [stack, w] of Object.entries(input.families)) {
    const fam = primaryFamily(stack);
    if (!fam) continue;
    const cur = usage.get(fam) ?? { weight: 0, stack };
    cur.weight += w;
    usage.set(fam, cur);
  }
  const headingUsage = new Map<string, number>();
  for (const [stack, w] of Object.entries(input.headingFamilies)) {
    const fam = primaryFamily(stack);
    headingUsage.set(fam, (headingUsage.get(fam) ?? 0) + w);
  }
  const total = [...usage.values()].reduce((s, v) => s + v.weight, 0) || 1;
  const ranked = [...usage.entries()].sort((a, b) => b[1].weight - a[1].weight);
  const bodyFamily = ranked[0]?.[0] ?? "system-ui";
  const headingFamily = [...headingUsage.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? bodyFamily;

  const weightsFor = (fam: string) => {
    const set = new Set<string>();
    const lower = fam.toLowerCase();
    for (const f of input.fontFaces) if (cleanFamily(f.family).toLowerCase() === lower) set.add(normaliseWeight(f.weight));
    for (const s of input.typeSamples) if (primaryFamily(s.fontFamily).toLowerCase() === lower) set.add(normaliseWeight(s.fontWeight));
    return [...set].sort((a, b) => parseFloat(a) - parseFloat(b));
  };

  const sourcesFor = (fam: string): FontSource[] => {
    const lower = fam.toLowerCase();
    const seen = new Set<string>();
    const out: FontSource[] = [];
    for (const face of input.parsedFaces) {
      if (face.family.toLowerCase() !== lower) continue;
      const src = bestSource(face.sources);
      if (!src || seen.has(src.url)) continue;
      seen.add(src.url);
      out.push({ url: src.url, weight: face.weight, style: face.style, format: src.format });
    }
    return out.slice(0, 12);
  };

  const families: FontFamilyInfo[] = [];
  for (const [fam, info] of ranked) {
    const share = info.weight / total;
    const isHeading = fam === headingFamily;
    const isBody = fam === bodyFamily;
    if (!isHeading && !isBody && (share < 0.03 || families.length >= 4)) continue;
    families.push({
      family: prettyFamily(fam),
      stack: info.stack,
      role: isHeading && isBody ? "heading & body" : isHeading ? "heading" : isBody ? "body" : "other",
      weights: weightsFor(fam),
      usage: Math.round(share * 1000) / 1000,
      sources: sourcesFor(fam),
      isSystem: isSystemFamily(fam),
    });
  }
  if (!families.some((f) => f.family === prettyFamily(headingFamily)) && headingFamily) {
    families.push({
      family: prettyFamily(headingFamily),
      stack: headingFamily,
      role: "heading",
      weights: weightsFor(headingFamily),
      usage: 0,
      sources: sourcesFor(headingFamily),
      isSystem: isSystemFamily(headingFamily),
    });
  }

  const scale = buildTypeScale(input.typeSamples);
  const p = scale.find((s) => s.tag === "p");
  return {
    families,
    headingFamily: prettyFamily(headingFamily),
    bodyFamily: prettyFamily(bodyFamily),
    scale,
    ratio: scaleRatio(scale),
    baseSize: p?.fontSize ?? 16,
  };
}

export function normaliseWeight(w: string): string {
  const t = w.trim().toLowerCase();
  if (t === "normal") return "400";
  if (t === "bold") return "700";
  // variable-font ranges ("100 900") keep their range
  return t;
}
