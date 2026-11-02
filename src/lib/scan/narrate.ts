// Templated, data-driven "thinking" sentences. Deterministic — no language model involved.
import type { ColorPalette, LogoSet, Typography, UiElements, Voice } from "../types";

const nf = new Intl.NumberFormat("en-US");

export function fmt(n: number): string {
  return nf.format(Math.round(n));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

export function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function narrateColors(p: ColorPalette, viewports: number): string {
  const chromatic = p.all.filter((c) => c.chromatic && c.share >= 0.005);
  const primary = p.roles.find((r) => r.role === "primary");
  const bg = p.roles.find((r) => r.role === "background");
  let s = `Sampled ${plural(p.samplePoints, "point")} across ${plural(viewports, "viewport")} — `;
  s += chromatic.length
    ? `${plural(chromatic.length, "chromatic cluster")} stand${chromatic.length === 1 ? "s" : ""} out`
    : "the palette is mostly neutral";
  if (primary) {
    s += /call-to-action/.test(primary.reason)
      ? `; ${primary.hex} dominates CTA backgrounds`
      : `; picked ${primary.hex} as primary (${/^[A-Z][a-z]/.test(primary.reason) ? primary.reason.charAt(0).toLowerCase() + primary.reason.slice(1) : primary.reason})`;
  }
  if (bg) s += `, on a ${bg.oklch.l > 0.6 ? "light" : "dark"} ${bg.hex} canvas`;
  return `${s}.`;
}

export function narrateTypography(t: Typography): string {
  const fams = t.families.slice(0, 3).map((f) => `${f.family} (${f.role}${f.usage ? `, ${Math.round(f.usage * 100)}% of text` : ""})`);
  const weights = new Set(t.families.flatMap((f) => f.weights));
  const h1 = t.scale.find((s) => s.tag === "h1");
  let s = `Found ${plural(t.families.length, "family", "families")}: ${listJoin(fams)}`;
  if (weights.size) s += ` using ${plural(weights.size, "weight")}`;
  if (h1) s += `; h1 is ${h1.fontSize}px over a ${t.baseSize}px body`;
  if (t.ratio) s += ` (≈${t.ratio} scale ratio)`;
  const webfonts = t.families.filter((f) => f.sources.length).length;
  if (webfonts) s += `; ${plural(webfonts, "web font")} downloadable`;
  return `${s}.`;
}

export function narrateLogo(l: LogoSet, candidates: number): string {
  if (!l.primary) {
    return l.icons.length
      ? `No convincing logo in the header — falling back to ${plural(l.icons.length, "icon")} (favicon / touch icon / og:image).`
      : "No logo or icons found on the page.";
  }
  const kind = l.primary.kind === "svg" ? "an inline SVG" : l.primary.kind === "img" ? "an image" : "a captured PNG";
  return `Scored ${plural(candidates, "candidate")}; best is ${kind} (${l.primary.width}×${l.primary.height}, score ${l.primary.score}: ${l.primary.reasons.slice(0, 3).join(", ")}). Also found ${plural(l.icons.length, "icon")}.`;
}

export function narrateUi(u: UiElements, images: number): string {
  const parts: string[] = [];
  if (u.primaryButton) {
    parts.push(`primary button “${u.primaryButton.label}” is ${u.primaryButton.background} with ${u.primaryButton.borderRadius} radius`);
  }
  if (u.secondaryButton) parts.push(`secondary “${u.secondaryButton.label}”`);
  parts.push(`${plural(u.radius.length, "radius token")}, ${plural(u.spacing.length, "spacing step")} on a 4px grid, ${plural(u.shadows.length, "shadow")}`);
  parts.push(`${plural(images, "content image")} kept for imagery`);
  const s = parts.join("; ");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

export function narrateVoice(v: Voice): string {
  const caseLabel = { sentence: "sentence case", title: "Title Case", upper: "ALL CAPS", mixed: "mixed case" }[v.stats.caseStyle];
  let s = v.stats.avgHeadlineWords
    ? `Headlines average ${v.stats.avgHeadlineWords} words in ${caseLabel}; “you” appears ${v.stats.youRate}× per 100 words`
    : `No headings to analyse, so voice is based on the title “${v.title}”`;
  if (v.keywords.length) s += `; top keywords: ${v.keywords.slice(0, 4).join(", ")}`;
  if (v.ctas.length) s += `; CTAs like “${v.ctas[0]}”`;
  return `${s}.`;
}
