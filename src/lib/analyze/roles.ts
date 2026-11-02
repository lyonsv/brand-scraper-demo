import type { ColorCluster, ColorRole, ColorRoleName, ContrastPair, Oklch } from "../types";
import { CLUSTER_DELTA_E as CLUSTER_DE, adjustLightness, deltaE, findCluster, hueDistance, isNeutral, parseColor } from "./color";
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
  // the dominant background, plus the runner-up when it's a neutral (not a brand-coloured band)
  const pageBgs = input.backgrounds
    .slice(0, 2)
    .filter((b, i) => i === 0 || isNeutral(parseColor(b.hex)?.oklch ?? { l: 0, c: 1, h: 0 }))
    .map((b) => b.hex);
  const textHex = input.texts[0]?.hex;
  const clashes = (hex: string) => pageBgs.some((bg) => deltaE(bg, hex) < 10);

  // 1. the strongest chromatic CTA colour: CTAs are grouped by colour and weighted by rank,
  //    so a colour used on several prominent buttons beats a one-off. Never the page
  //    background or body-text colour.
  const groups: Array<{ hex: string; oklch: Oklch; weight: number; label: string }> = [];
  input.ctas.slice(0, 12).forEach((cta, i) => {
    const p = parseColor(cta.bg);
    if (!p || p.alpha < 0.5 || isNeutral(p.oklch) || clashes(p.hex)) return;
    if (textHex && deltaE(textHex, p.hex) < 10) return;
    const w = 1 / (1 + i * 0.35);
    const g = groups.find((x) => deltaE(x.hex, p.hex) < CLUSTER_DE);
    if (g) g.weight += w;
    else groups.push({ hex: p.hex, oklch: p.oklch, weight: w, label: cta.label });
  });
  if (groups.length) {
    const best = groups.sort((a, b) => b.weight - a.weight)[0];
    const cluster = findCluster(input.clusters, best.hex);
    return makeRole("primary", cluster?.hex ?? best.hex, cluster?.oklch ?? best.oklch, `Background of the "${best.label}" call-to-action`);
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
  // 3. a neutral CTA that is neither the page background nor the body-text colour
  const isText = (hex: string) => !!textHex && deltaE(textHex, hex) < 10;
  for (const cta of input.ctas.slice(0, 4)) {
    const p = parseColor(cta.bg);
    if (p && p.alpha >= 0.5 && !clashes(p.hex) && !isText(p.hex)) {
      return makeRole("primary", p.hex, p.oklch, `Background of the "${cta.label}" call-to-action (monochrome brand)`);
    }
  }
  // 4. the most prominent vivid colour on the page. Colours the stylesheet also defines as CSS
  //    variables (design-system colours) count triple, so a defined brand hue beats a stray
  //    illustration colour of similar usage.
  const onPage = (c: ColorCluster) => (c.sources.background ?? 0) + (c.sources.text ?? 0) + (c.sources.border ?? 0) + (c.sources.cta ?? 0);
  const vividScore = (c: ColorCluster) => c.share * ((c.sources.variable ?? 0) > 0 ? 3 : 1);
  const vivid = input.clusters
    .filter((c) => c.oklch.c >= 0.08 && onPage(c) > 0 && !clashes(c.hex))
    .map((c) => ({ c, score: vividScore(c) }))
    .filter((x) => x.score >= 0.002)
    .sort((a, b) => b.score - a.score)[0]?.c;
  if (vivid) {
    const varName = (vivid.sources.variable ?? 0) > 0
      ? Object.entries(input.cssVars).find(([, v]) => {
          const p = parseColor(v);
          return p && vivid.members.includes(p.hex);
        })?.[0]
      : undefined;
    return makeRole("primary", vivid.hex, vivid.oklch, varName ? `CSS variable ${varName}, also used on the page` : "Most prominent vivid colour on the page");
  }
  // 4b. a monochrome brand whose CTA is simply the text colour (black-on-white or white-on-black)
  for (const cta of input.ctas.slice(0, 4)) {
    const p = parseColor(cta.bg);
    if (p && p.alpha >= 0.5 && !clashes(p.hex)) {
      return makeRole("primary", p.hex, p.oklch, `Background of the "${cta.label}" call-to-action (monochrome brand, same as text)`);
    }
  }
  const chroma = input.clusters.find((c) => c.chromatic && c.share >= 0.004 && !clashes(c.hex));
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
    (c) =>
      c.chromatic &&
      c.share >= 0.004 &&
      // very dark or very pale clusters only count when they are used a lot
      ((c.oklch.l >= 0.25 && c.oklch.l <= 0.93) || c.share >= 0.03) &&
      (!primary || deltaE(c.hex, primary.hex) >= 10),
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
