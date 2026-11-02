// Export formats for a finished BrandGuide. Pure, client-safe.
import type { BrandGuide } from "./types";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function stack(family: string, generic = "sans-serif"): string {
  return `"${family.replace(/"/g, "")}", ${generic}`;
}

export function toCssVariables(b: BrandGuide): string {
  const lines: string[] = [`/* ${b.name} — extracted from ${b.finalUrl} */`, ":root {"];
  for (const r of b.colors.roles) lines.push(`  --color-${r.role}: ${r.hex};`);
  const primary = b.colors.roles.find((r) => r.role === "primary");
  if (primary) lines.push(`  --color-on-primary: ${primary.onColor};`);
  lines.push(`  --font-heading: ${stack(b.typography.headingFamily)};`);
  lines.push(`  --font-body: ${stack(b.typography.bodyFamily)};`);
  for (const s of b.typography.scale) lines.push(`  --text-${s.tag}: ${s.fontSize}px;`);
  b.ui.radius.forEach((r, i) => lines.push(`  --radius-${i + 1}: ${r.value};`));
  b.ui.spacing.forEach((s, i) => lines.push(`  --space-${i + 1}: ${s.value};`));
  b.ui.shadows.forEach((s, i) => lines.push(`  --shadow-${i + 1}: ${s.value};`));
  lines.push("}");
  return lines.join("\n");
}

export function toJson(b: BrandGuide): string {
  const tokens = {
    name: b.name,
    source: b.finalUrl,
    colors: Object.fromEntries(b.colors.roles.map((r) => [r.role, r.hex])),
    fonts: { heading: b.typography.headingFamily, body: b.typography.bodyFamily },
    typeScale: Object.fromEntries(b.typography.scale.map((s) => [s.tag, { size: s.fontSize, weight: s.fontWeight, lineHeight: s.lineHeight }])),
    radius: b.ui.radius.map((r) => r.value),
    spacing: b.ui.spacing.map((s) => s.value),
    shadows: b.ui.shadows.map((s) => s.value),
    buttons: { primary: b.ui.primaryButton, secondary: b.ui.secondaryButton },
    voice: { traits: b.voice.traits, keywords: b.voice.keywords, ctas: b.voice.ctas },
  };
  return JSON.stringify(tokens, null, 2);
}

/** Tailwind v4 `@theme` block (CSS-first config). */
export function toTailwindTheme(b: BrandGuide): string {
  const name = slug(b.name) || "brand";
  const lines: string[] = [`/* Tailwind v4 theme for ${b.name} */`, "@theme {"];
  for (const r of b.colors.roles) lines.push(`  --color-${name}-${r.role}: ${r.hex};`);
  lines.push(`  --font-heading: ${stack(b.typography.headingFamily)};`);
  lines.push(`  --font-body: ${stack(b.typography.bodyFamily)};`);
  b.ui.radius.forEach((r, i) => lines.push(`  --radius-${name}-${i + 1}: ${r.value};`));
  b.ui.shadows.slice(0, 2).forEach((s, i) => lines.push(`  --shadow-${name}-${i + 1}: ${s.value};`));
  lines.push("}");
  lines.push("");
  lines.push(`/* usage: <button class="bg-${name}-primary text-white rounded-${name}-1 font-heading">… */`);
  return lines.join("\n");
}
