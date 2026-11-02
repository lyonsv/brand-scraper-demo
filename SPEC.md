# Brand Scraper Demo — SPEC

A Next.js app: enter a website URL → the server drives headless Chromium, streams progress (screenshots + a step-by-step "thinking" log) → the page renders a **brand guideline** and a **demo landing page** built from the extracted tokens. Deterministic only: **no LLM calls anywhere.** The "thinking" text is templated from real extraction data.

UX flow is inspired by ploy.ai/migration-cost-calculator (input pill → live two-column scan panel that fills progressively → results sections). Use our own neutral visual identity — do NOT copy Ploy's branding, copy, colours, or code.

## Stack
- Next.js (latest stable, App Router, TypeScript, `src/` dir), Tailwind CSS, pnpm.
- `playwright` (Chromium already installed in `~/Library/Caches/ms-playwright`), `culori` for colour maths.
- Runs locally with `pnpm dev`. No deployment target. No database.

## Server: `POST /api/scan` → NDJSON stream
`Content-Type: application/x-ndjson`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`. Body `{ url }` (bare domains allowed; normalise to https).

Event types (one JSON object per line, all typed in `src/lib/types.ts`):
- `{type:"start", url}`
- `{type:"step", id, status:"running"|"done"|"warn", title, detail?}` — the thinking log. `detail` is a templated, data-driven sentence, e.g. "Sampled 1,840 points across 6 viewports — 3 chromatic clusters stand out; #635BFF dominates CTA backgrounds."
- `{type:"shot", label, data}` — base64 JPEG (quality ~60). At least: initial viewport, plus 2–4 more while scrolling. The client shows the latest one in the screenshot card.
- `{type:"partial", key, value}` — a guideline section ready early (colors, typography, logo, …) so the results fill progressively.
- `{type:"done", brand}` — full `BrandGuide`.
- `{type:"error", message, code}` — codes: `invalid_url`, `blocked_url` (SSRF), `bot_protected`, `timeout`, `nav_failed`, `internal`.

Pipeline steps (each emits step running→done with real numbers):
1. Validate URL (http/https only; DNS-resolve; reject private, loopback, link-local and metadata IPs; repeat the check on every request via `context.route` to catch redirects).
2. Launch/reuse browser (singleton on `globalThis`; new context per job, 1440×900, realistic UA, `bypassCSP:true`, `serviceWorkers:"block"`, `acceptDownloads:false`; block media and known analytics hosts). Semaphore of 2 concurrent jobs.
3. Navigate (`domcontentloaded`, then race `networkidle` against 5s). Detect challenge pages (403/503, "Just a moment", captcha iframes) → `bot_protected`.
4. Dismiss cookie banners (known consent-platform selectors → role-name regex → hide large fixed overlays).
5. Scroll for lazy-loaded content (≤12 steps, 250ms each), taking screenshots and grid-sampling background colours along the way. Scroll back to the top.
6. Extract (logic in `src/lib/extract/extractor.js`, plain JS passed as a string to `page.evaluate`): colours (grid-sampled backgrounds, text weighted by length×size, borders), CTA buttons + link styles, CSS custom properties from `:root`, `html` and `body` (try/catch on cross-origin sheets), fonts (`document.fonts` loaded faces + computed families weighted by text length), size scale (h1–h6, p, small), radius, spacing (snapped to 4px), shadows, logo candidates (scoring table: header/nav +3, logo/brand in id/class/alt/aria/filename +4, link to "/" +3, top-left +2, sane aspect ratio +1; inline SVG serialised with currentColor resolved; plus PNG element screenshot fallback), icons (apple-touch-icon, icons, manifest, og:image), imagery (up to 8 large content images), voice (title, meta description, h1, top 6 h2/h3, CTA labels).
7. Analyse on the server (`src/lib/analyze/*.ts`, pure functions with unit tests): convert to OKLCH with culori; chroma < 0.035 counts as neutral; greedy area-weighted clustering at ΔE2000 < 6; assign roles (primary = top CTA cluster or brand CSS variable, secondary/accent = next chromatic cluster with hue ≥30° away, background/surface/text/border/muted from neutrals); WCAG contrast pairs; type scale; voice summary (heuristics only: average headline length, sentence case vs title case, exclamation use, second-person "you" frequency, top keywords).
8. Emit `done`.

Overall timeout 90s via `AbortSignal.any([req.signal, AbortSignal.timeout(90_000)])`; a client disconnect closes the context. Always close the context in `finally`.

## Client UI (single page `/`)
Own design: clean, neutral, generous whitespace, one accent colour, system/Inter font, light theme required (dark optional).

1. **Hero + input:** H1 ("Turn any website into a brand guideline"), subcopy, pill input (placeholder `yourbrand.com`) + "Extract brand →" button, disabled while empty. While running, the button shows a spinner and "Scanning…".
2. **Scan panel** (appears instantly on submit, two columns, stacks on mobile):
   - Left: browser-chrome frame showing the latest `shot` (crossfade between shots; placeholder with a spinner "Capturing homepage…" before the first one).
   - Right: status pill (Scanning ⟳ / ✓ Complete / ⚠ Error) + URL, and the **thinking log**: each step appears as a row with a spinner, which becomes ✓ (or ⚠). Title in bold; `detail` text reveals with a short typewriter effect (≤600ms per line; respect `prefers-reduced-motion`). Auto-scrolls. The stream is the source of truth; no fake delays except the typewriter.
3. **Brand guideline** (sections reveal as `partial`/`done` arrive; skeletons before):
   - Logo (primary + icon set, on light and dark tiles, download links).
   - Colour palette: role swatches (name, hex, OKLCH, contrast vs white/black with AA/AAA badge, click to copy) + "all extracted colours" strip weighted by usage.
   - Typography: each family with sample text rendered in that family (load it via a `<link>`/@font-face from the original URLs when available, else fall back), weights found, size scale ladder.
   - UI elements: rendered recreations of primary/secondary buttons and links using the extracted styles; radius, spacing and shadow tokens.
   - Imagery: thumbnail grid.
   - Voice & tone: headline samples, CTA labels, heuristic traits as chips.
   - Export: copy as CSS variables, copy as JSON, Tailwind theme snippet.
4. **Demo page:** "Here's a new page in their brand" — a rendered landing page (inside a framed preview with a desktop/mobile toggle) generated purely from tokens: nav with logo, hero (headline from their h1 or a templated variant, their CTA label, primary button), 3-feature grid (titles from h2s), image strip from imagery, testimonial/CTA band in primary colour, footer. Must look plausibly on-brand. Use contrast checks to pick text colours on coloured backgrounds.
5. **Error card:** icon, friendly message per code, "↻ Try another URL".

Also show a small "Try:" row of example domains (e.g. stripe.com, linear.app, vercel.com, airbnb.com).

## Quality bar / acceptance
- `pnpm build` passes; `pnpm lint` and `tsc --noEmit` are clean.
- Vitest unit tests for analyse functions (clustering, role assignment, contrast, type scale, voice heuristics) and the URL validator (SSRF cases).
- End-to-end smoke script `pnpm smoke <url>` (`scripts/smoke.ts`): runs the stream against the dev server and asserts that `done` arrives with a primary colour, ≥1 font and a logo or icon.
- Works on stripe.com, linear.app and vercel.com; example.com gives a sensible minimal result or a clear error, not a crash.
- No `any` leaks in public types; the extractor stays plain JS; no secrets; no LLM calls.
- `README.md`: how to run, architecture, limitations.
