// Generates a self-contained landing page (HTML string for an iframe srcdoc) purely from tokens.
import { readableOn } from "../analyze/color";
import { contrastRatio, pickTextColor } from "../analyze/contrast";
import { familyFor, familyStack, fontFaceCss } from "../fonts";
import type { BrandGuide, ColorRoleName } from "../types";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

/** Only allow http(s) and data:image URLs into the generated markup. */
export function safeUrl(u: string): string | null {
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(u)) return u;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

/** Linear sRGB-space mix of two #RRGGBB colours: amount of `a` over `b`. */
export function mixHex(a: string, b: string, amount: number): string {
  const pa = parseInt(a.slice(1, 7), 16);
  const pb = parseInt(b.slice(1, 7), 16);
  const ch = (n: number, shift: number) => (n >> shift) & 255;
  const mix = (shift: number) => Math.round(ch(pa, shift) * amount + ch(pb, shift) * (1 - amount));
  return `#${[16, 8, 0].map((sh) => mix(sh).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export interface DemoTokens {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  onPrimary: string;
  /** primary adjusted to ≥3:1 against the page background, for text, icons and accents */
  primaryText: string;
  /** tinted badge background (primary at 12% over the card surface) and its readable label */
  badgeBg: string;
  badgeText: string;
  secondary: string;
  radius: string;
  buttonRadius: string;
  headingFont: string;
  bodyFont: string;
  headingWeight: string;
  headingTracking: string;
}

export function demoTokens(b: BrandGuide): DemoTokens {
  const role = (r: ColorRoleName) => b.colors.roles.find((x) => x.role === r)?.hex;
  const bg = role("background") ?? "#FFFFFF";
  const text = role("text") ?? pickTextColor(bg);
  const primary = role("primary") ?? text;
  // the band and buttons use primary as a background: pick a readable label colour
  const onPrimary = pickTextColor(primary, [bg, text]);
  const secondary = role("secondary") ?? role("accent") ?? primary;
  const radii = b.ui.radius.map((r) => parseFloat(r.value)).filter((n) => n > 0 && n < 999);
  const cardRadius = radii.length ? `${Math.min(24, Math.max(...radii))}px` : "12px";
  const h1 = b.typography.scale.find((s) => s.tag === "h1");
  const surface = role("surface") ?? bg;
  const primaryText = readableOn(primary, bg, 3, [text]);
  const badgeBg = mixHex(primaryText, surface, 0.12);
  const badgeText = readableOn(primaryText, badgeBg, 3, [text]);
  return {
    bg,
    primaryText,
    badgeBg,
    badgeText,
    surface,
    text,
    muted: role("muted") ?? text,
    border: role("border") ?? text,
    primary,
    onPrimary,
    secondary,
    radius: cardRadius,
    buttonRadius: b.ui.primaryButton?.borderRadius ?? "8px",
    headingFont: familyStack(familyFor(b.typography, "heading")),
    bodyFont: familyStack(familyFor(b.typography, "body")),
    headingWeight: h1?.fontWeight ?? "700",
    headingTracking: h1 && h1.letterSpacing !== "normal" ? h1.letterSpacing : "-0.02em",
  };
}

export function buildDemoHtml(b: BrandGuide): string {
  const t = demoTokens(b);
  const name = escapeHtml(b.name);
  const logoUrl = b.logo.primary ? safeUrl(b.logo.primary.src) : null;
  const logo = logoUrl
    ? `<img class="logo" src="${escapeAttr(logoUrl)}" alt="${name}" referrerpolicy="no-referrer">`
    : `<span class="wordmark">${name}</span>`;
  const headline = escapeHtml(truncate(b.voice.headline || `Meet the new ${b.name}`, 90));
  const sub = escapeHtml(
    truncate(b.voice.description || (b.voice.keywords.length ? `${b.name} for ${b.voice.keywords.slice(0, 3).join(", ")}.` : `Everything you love about ${b.name}, in one place.`), 200),
  );
  const cta = escapeHtml(truncate(b.ui.primaryButton?.label || b.voice.ctas[0] || "Get started", 28));
  const rawCta = b.ui.primaryButton?.label || b.voice.ctas[0] || "Get started";
  const cta2Label = [b.ui.secondaryButton?.label, ...b.voice.ctas].find((c) => c && c.toLowerCase() !== rawCta.toLowerCase()) ?? "Learn more";
  const cta2 = escapeHtml(truncate(cta2Label, 28));
  const kw = b.voice.keywords;
  const featureTitles = [...b.voice.headings, ...kw.map((k) => `Built for ${k}`), "Fast by default", "Made for teams", "Secure from day one"].slice(0, 3);
  const featureBodies = [
    kw[0] ? `Everything around ${kw[0]} handled in one place, so you can focus on what matters.` : "Everything handled in one place, so you can focus on what matters.",
    kw[1] ? `Purpose-built tools for ${kw[1]}, designed to scale with you.` : "Purpose-built tools designed to scale with you.",
    kw[2] ? `Insights on ${kw[2]} that help you move faster with confidence.` : "Insights that help you move faster with confidence.",
  ];
  const features = featureTitles
    .map(
      (title, i) => `
      <article class="card">
        <div class="badge">${String(i + 1).padStart(2, "0")}</div>
        <h3>${escapeHtml(truncate(title, 70))}</h3>
        <p>${escapeHtml(featureBodies[i])}</p>
      </article>`,
    )
    .join("");
  const images = b.imagery
    .map((img) => safeUrl(img.src))
    .filter((u): u is string => !!u)
    .slice(0, 4)
    .map((u, i) => `<div class="shot"><img src="${escapeAttr(u)}" alt="${escapeAttr(b.imagery[i]?.alt ?? "")}" loading="lazy" referrerpolicy="no-referrer"></div>`)
    .join("");
  const bandHeadline = escapeHtml(truncate(b.voice.headings[3] ?? `Start building with ${b.name} today`, 80));
  // the band button inverts: background = band text colour, label = primary
  const bandBtnBg = t.onPrimary;
  const bandBtnText = contrastRatio(t.primary, bandBtnBg) >= 3 ? t.primary : pickTextColor(bandBtnBg);
  const year = new Date(b.scannedAt).getFullYear();
  const navLinks = ["Product", "Solutions", "Pricing", "Company"].map((l) => `<a href="#">${l}</a>`).join("");
  const ghostBorder = contrastRatio(t.border, t.bg) >= 1.3 ? t.border : t.muted;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} — demo</title>
<style>
${fontFaceCss(b.typography.families)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{overflow-x:hidden}
body{background:${t.bg};color:${t.text};font-family:${t.bodyFont};font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.wrap{max-width:1160px;margin:0 auto;padding:0 32px}
h1,h2,h3{font-family:${t.headingFont};font-weight:${t.headingWeight};letter-spacing:${t.headingTracking};line-height:1.08}
nav{display:flex;align-items:center;justify-content:space-between;height:72px;border-bottom:1px solid ${t.border}}
.logo{height:28px;width:auto;max-width:160px;object-fit:contain;display:block}
.wordmark{font-family:${t.headingFont};font-weight:700;font-size:20px;letter-spacing:-0.01em}
.links{display:flex;gap:28px;font-size:14px;color:${t.muted}}
.btn{display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border-radius:${t.buttonRadius};font-weight:600;font-size:15px;border:1px solid transparent;white-space:nowrap}
.btn-primary{background:${t.primary};color:${t.onPrimary}}
.btn-ghost{border-color:${ghostBorder};color:${t.text}}
.btn-sm{padding:8px 14px;font-size:14px}
.hero{position:relative;padding:96px 0 80px}
.hero .glow{position:absolute;inset:-40% -10% auto auto;width:720px;height:720px;border-radius:50%;background:radial-gradient(circle at center, ${t.primaryText}33, ${t.secondary}14 45%, transparent 70%);pointer-events:none}
.hero h1{font-size:64px;max-width:820px;position:relative}
.hero p{font-size:20px;color:${t.muted};max-width:640px;margin-top:24px;position:relative}
.hero .ctas{display:flex;gap:12px;margin-top:36px;position:relative;flex-wrap:wrap}
.features{padding:24px 0 88px}
.eyebrow{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:${t.primaryText};margin-bottom:12px}
.features h2{font-size:40px;max-width:640px;margin-bottom:40px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.card{background:${t.surface};border:1px solid ${t.border};border-radius:${t.radius};padding:28px}
.card h3{font-size:20px;margin:18px 0 10px;line-height:1.25}
.card p{color:${t.muted};font-size:15px}
.badge{width:40px;height:40px;border-radius:${t.radius};background:${t.badgeBg};color:${t.badgeText};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px}
.strip{display:grid;grid-template-columns:repeat(${Math.max(1, Math.min(4, b.imagery.length))},1fr);gap:16px;padding-bottom:88px}
.shot{aspect-ratio:4/3;border-radius:${t.radius};overflow:hidden;background:${t.surface};border:1px solid ${t.border}}
.shot img{width:100%;height:100%;object-fit:cover;display:block}
.band{background:${t.primary};color:${t.onPrimary};border-radius:${t.radius};padding:64px;display:flex;align-items:center;justify-content:space-between;gap:32px;margin-bottom:88px}
.band h2{font-size:36px;max-width:620px}
.band p{opacity:.85;margin-top:12px;max-width:560px}
.band .btn{background:${bandBtnBg};color:${bandBtnText}}
footer{border-top:1px solid ${t.border};padding:48px 0;color:${t.muted};font-size:14px}
footer .cols{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap}
footer .col{display:flex;flex-direction:column;gap:8px}
footer .col strong{color:${t.text};font-weight:600;margin-bottom:4px}
footer .legal{margin-top:40px}
@media (max-width:720px){
  .wrap{padding:0 20px}
  .links{display:none}
  .hero{padding:56px 0 48px}
  .hero h1{font-size:38px}
  .hero p{font-size:17px}
  .features h2{font-size:28px}
  .grid{grid-template-columns:1fr}
  .strip{grid-template-columns:1fr 1fr}
  .band{flex-direction:column;align-items:flex-start;padding:36px 28px}
  .band h2{font-size:26px}
}
</style></head>
<body>
<div class="wrap">
  <nav>${logo}<div class="links">${navLinks}</div><a class="btn btn-primary btn-sm" href="#">${cta}</a></nav>
  <section class="hero"><div class="glow"></div>
    <h1>${headline}</h1>
    <p>${sub}</p>
    <div class="ctas"><a class="btn btn-primary" href="#">${cta} →</a><a class="btn btn-ghost" href="#">${cta2}</a></div>
  </section>
  <section class="features">
    <div class="eyebrow">Why ${name}</div>
    <h2>${escapeHtml(truncate(b.voice.headings[0] ? `Everything you need, the ${b.name} way` : `Why teams choose ${b.name}`, 70))}</h2>
    <div class="grid">${features}</div>
  </section>
  ${images ? `<section class="strip">${images}</section>` : ""}
  <section class="band">
    <div><h2>${bandHeadline}</h2><p>${sub}</p></div>
    <a class="btn" href="#">${cta} →</a>
  </section>
  <footer>
    <div class="cols">
      <div class="col">${logo}<span style="margin-top:12px;max-width:260px">${escapeHtml(truncate(b.voice.description || b.voice.title, 120))}</span></div>
      <div class="col"><strong>Product</strong><a href="#">Overview</a><a href="#">Pricing</a><a href="#">Changelog</a></div>
      <div class="col"><strong>Company</strong><a href="#">About</a><a href="#">Careers</a><a href="#">Contact</a></div>
      <div class="col"><strong>Resources</strong><a href="#">Docs</a><a href="#">Guides</a><a href="#">Support</a></div>
    </div>
    <div class="legal">© ${year} ${name}. Demo page generated from extracted brand tokens.</div>
  </footer>
</div>
</body></html>`;
}
