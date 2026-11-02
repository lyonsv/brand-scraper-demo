import type { ColorCluster, ColorRole, ColorRoleName, ContrastPair, Oklch } from "../types";
import { adjustLightness, deltaE, findCluster, hueDistance, isNeutral, parseColor } from "./color";
import { contrast, contrastRatio, pickTextColor } from "./contrast";

export interface WeightedHex {
  hex: string;
  weight: number;
}

export interface RoleInput {
  clusters: ColorCluster[];
  /** CTA button backgrounds, best-scored first (raw CSS colour strings) */
  ctas: Array<{ bg: string; label: string }>;
  cssVars: Record<string, string>;
  backgrounds: WeightedHex[];
  texts: WeightedHex[];
  borders: WeightedHex[];
}

export interface RoleResult {
  roles: ColorRole[];
  pairs: ContrastPair[];
}

const BRAND_VAR = /(brand|primary|accent)/i;
const NOT_BRAND_VAR = /(text|fg|foreground|border|shadow|muted|disabled|bg-?subtle|hover|focus|ring|outline|on-)/i;

function makeRole(role: ColorRoleName, hex: string, oklch: Oklch, reason: string, derived = false): ColorRole {
  return {
    role,
    hex,
    oklch,
    reason,
    derived,
    onWhite: contrast(hex, "#FFFFFF"),
    onBlack: contrast(hex, "#000000"),
    onColor: pickTextColor(hex),
  };
}

function fromHex(role: ColorRoleName, hex: string, reason: string, derived = false): ColorRole | null {
  const p = parseColor(hex);
  return p ? makeRole(role, p.hex, p.oklch, reason, derived) : null;
}

/** Normalise and sort a raw weight list, dropping unparsable colours. */
export function toWeightedHex(map: Record<string, number>): WeightedHex[] {
  const merged = new Map<string, number>();
  for (const [color, w] of Object.entries(map)) {
    const p = parseColor(color);
    if (!p || p.alpha < 0.5) continue;
    merged.set(p.hex, (merged.get(p.hex) ?? 0) + w);
  }
  return [...merged.entries()].map(([hex, weight]) => ({ hex, weight })).sort((a, b) => b.weight - a.weight);
}

export function pickPrimary(input: RoleInput): ColorRole | null {
  // 1. a chromatic CTA background among the top-scored buttons
  for (const cta of input.ctas.slice(0, 6)) {
    const p = parseColor(cta.bg);
    if (p && !isNeutral(p.oklch) && p.alpha >= 0.5) {
      const cluster = findCluster(input.clusters, p.hex);
      return makeRole("primary", cluster?.hex ?? p.hex, cluster?.oklch ?? p.oklch, `Background of the "${cta.label}" call-to-action`);
    }
  }
  // 2. a brand-named CSS custom property
  const vars = Object.entries(input.cssVars)
    .filter(([name]) => BRAND_VAR.test(name) && !NOT_BRAND_VAR.test(name))
    .map(([name, value]) => ({ name, parsed: parseColor(value) }))
    .filter((v) => v.parsed && !isNeutral(v.parsed.oklch) && v.parsed.alpha > 0.9);
  if (vars.length) {
    // prefer the most "base" looking name (shortest), e.g. --brand over --brand-light-200
    vars.sort((a, b) => a.name.length - b.name.length);
    const v = vars[0];
    return makeRole("primary", v.parsed!.hex, v.parsed!.oklch, `CSS variable ${v.name}`);
  }
  // 3. a neutral CTA that stands out from the page (monochrome brands such as black buttons)
  const pageBg = input.backgrounds[0]?.hex;
  for (const cta of input.ctas.slice(0, 4)) {
    const p = parseColor(cta.bg);
    if (p && p.alpha >= 0.5 && (!pageBg || deltaE(pageBg, p.hex) > 10)) {
      return makeRole("primary", p.hex, p.oklch, `Background of the "${cta.label}" call-to-action (monochrome brand)`);
    }
  }
  // 4. the most-used chromatic colour
  const chroma = input.clusters.find((c) => c.chromatic && c.share >= 0.004);
  if (chroma) return makeRole("primary", chroma.hex, chroma.oklch, "Most-used chromatic colour on the page");
  // 5. the darkest text colour
  const dark = [...input.texts].sort((a, b) => (parseColor(a.hex)?.oklch.l ?? 1) - (parseColor(b.hex)?.oklch.l ?? 1))[0];
  if (dark) return fromHex("primary", dark.hex, "No brand colour found; using the darkest text colour", true);
  return null;
}

export function assignRoles(input: RoleInput): RoleResult {
  const roles: ColorRole[] = [];
  const primary = pickPrimary(input);
  if (primary) roles.push(primary);

  // secondary / accent: next chromatic clusters at least 30° of hue away
  const chromatic = input.clusters.filter(
    (c) => c.chromatic && c.share >= 0.002 && (!primary || deltaE(c.hex, primary.hex) >= 10),
  );
  const isFarFrom = (c: ColorCluster, others: ColorRole[]) =>
    others.every((o) => isNeutral(o.oklch) || hueDistance(c.oklch.h, o.oklch.h) >= 30);
  const secondaryCluster = chromatic.find((c) => isFarFrom(c, primary ? [primary] : []));
  let secondary: ColorRole | null = null;
  if (secondaryCluster) {
    secondary = makeRole("secondary", secondaryCluster.hex, secondaryCluster.oklch, `Next most-used chromatic colour (${(secondaryCluster.share * 100).toFixed(1)}% of usage)`);
    roles.push(secondary);
    const accentCluster = chromatic.find((c) => c !== secondaryCluster && isFarFrom(c, [primary, secondary].filter((r): r is ColorRole => !!r)));
    if (accentCluster) {
      roles.push(makeRole("accent", accentCluster.hex, accentCluster.oklch, `Third distinct hue (${(accentCluster.share * 100).toFixed(1)}% of usage)`));
    }
  }

  // background: dominant sampled background, preferring a neutral one
  const bgs = input.backgrounds;
  let bgHex = bgs[0]?.hex ?? "#FFFFFF";
  const neutralBg = bgs.find((b) => {
    const p = parseColor(b.hex);
    return p && isNeutral(p.oklch);
  });
  if (neutralBg && bgs[0] && neutralBg.hex !== bgs[0].hex && neutralBg.weight >= bgs[0].weight * 0.5) bgHex = neutralBg.hex;
  const background = fromHex("background", bgHex, "Most common page background (grid-sampled)")!;
  roles.push(background);
  const bgIsLight = background.oklch.l > 0.6;

  // surface: next background close to the page background but distinct
  const surfaceHit = bgs.find((b) => {
    if (b.hex === bgHex) return false;
    const p = parseColor(b.hex);
    if (!p || p.oklch.c > 0.06) return false;
    const d = deltaE(b.hex, bgHex);
    return d >= 1.5 && d < 25;
  });
  roles.push(
    surfaceHit
      ? fromHex("surface", surfaceHit.hex, "Second most common neutral background")!
      : fromHex("surface", adjustLightness(bgHex, bgIsLight ? -0.03 : 0.05), "Derived from the background (slightly offset)", true)!,
  );

  // text: dominant readable text colour
  const readable = input.texts.filter((t) => contrastRatio(t.hex, bgHex) >= 3);
  const textHex = readable[0]?.hex ?? pickTextColor(bgHex);
  roles.push(fromHex("text", textHex, readable[0] ? "Most common text colour (weighted by length × size)" : "Derived for contrast", !readable[0])!);

  // muted: secondary text with lower contrast
  const textRatio = contrastRatio(textHex, bgHex);
  const muted = input.texts.find((t) => {
    if (t.hex === textHex) return false;
    const p = parseColor(t.hex);
    if (!p || p.oklch.c > 0.08) return false;
    const r = contrastRatio(t.hex, bgHex);
    return r >= 2.5 && r < textRatio && deltaE(t.hex, textHex) >= 5;
  });
  roles.push(
    muted
      ? fromHex("muted", muted.hex, "Secondary text colour (lower contrast)")!
      : fromHex("muted", adjustLightness(textHex, bgIsLight ? 0.3 : -0.3), "Derived from the text colour", true)!,
  );

  // border
  const border = input.borders.find((b) => {
    const p = parseColor(b.hex);
    return p && p.oklch.c < 0.06 && deltaE(b.hex, bgHex) >= 2;
  });
  roles.push(
    border
      ? fromHex("border", border.hex, "Most common border colour")!
      : fromHex("border", adjustLightness(bgHex, bgIsLight ? -0.1 : 0.12), "Derived from the background", true)!,
  );

  const get = (r: ColorRoleName) => roles.find((x) => x.role === r);
  const pairs: ContrastPair[] = [];
  const pair = (label: string, fg?: ColorRole | string, bg?: ColorRole) => {
    if (!fg || !bg) return;
    const fgHex = typeof fg === "string" ? fg : fg.hex;
    pairs.push({ label, fgHex, bgHex: bg.hex, result: contrast(fgHex, bg.hex) });
  };
  pair("Text on background", get("text"), get("background"));
  pair("Muted on background", get("muted"), get("background"));
  pair("Text on surface", get("text"), get("surface"));
  pair("Primary on background", get("primary"), get("background"));
  if (primary) pair("Label on primary", primary.onColor, primary);
  const sec = get("secondary");
  if (sec) pair("Label on secondary", sec.onColor, sec);

  return { roles, pairs };
}
