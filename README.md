# Brand Scraper Demo

Enter a website URL. The server opens it in headless Chromium, streams progress (screenshots plus a step-by-step "thinking" log), and the page fills in a **brand guideline** (logo, colours, typography, UI elements, imagery, voice, export) and a **demo landing page** built only from the extracted tokens.

Everything is deterministic. There are **no LLM calls**: every "thinking" sentence is a template filled with real numbers from the scan.

## Run it

```bash
pnpm install
pnpm exec playwright install chromium   # once, if the matching browser build is missing
pnpm dev                                 # http://localhost:3210
```

| Script | What it does |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js on port 3210 |
| `pnpm test` | Vitest unit tests (colour clustering, roles, contrast, type scale, voice, URL/SSRF validator, demo generator) |
| `pnpm lint`, `pnpm typecheck` | ESLint, `tsc --noEmit` |
| `pnpm smoke <url> [...]` | Streams `/api/scan` on a running server and asserts `done` has a primary colour, at least one font and a logo or icon. `--allow-minimal` drops the logo requirement, `--allow-error` accepts a clean error event. `BASE_URL` overrides the server. |
| `pnpm shot <url> [dir]` | Drives the UI in Chromium and saves idle, mid-scan, full-page and demo screenshots (`WIDTH=390` for mobile) |

## Architecture

```
src/
  app/
    page.tsx                 → <ScanApp/> (client)
    api/scan/route.ts        POST → NDJSON stream (90s budget, client disconnect aborts)
    api/font/route.ts        font proxy: public hosts only, font extensions only, 3 MB cap
  lib/
    types.ts                 stream events, raw extraction, BrandGuide
    url.ts                   normalise + SSRF checks (DNS resolve, private/loopback/link-local/metadata ranges, IPv6, mapped v4)
    scan/pipeline.ts         the 8 steps; emits step/shot/partial/done/error
    scan/browser.ts          Chromium singleton on globalThis + 2-slot semaphore
    scan/cookies.ts          consent dismissal: known CMP selectors → iframe CMPs → button-text regex → hide big fixed overlays
    scan/narrate.ts          templated thinking-log sentences
    extract/extractor.js     in-page extractor (plain JS, read from disk, passed as a string to page.evaluate)
    extract/sampler.js       elementFromPoint grid sampler for background colours
    analyze/                 pure functions: color.ts (culori OKLCH + CIEDE2000 clustering), roles.ts,
                             contrast.ts (WCAG), typography.ts, voice.ts, index.ts (UI tokens, logo set, brand name)
    demo/generate.ts         landing page HTML from tokens (escaped, contrast-checked), shown in a sandboxed iframe
    export.ts, fonts.ts      CSS variables / JSON / Tailwind v4 theme; @font-face via the proxy
  components/                ScanApp, ScanPanel (browser frame + thinking log with typewriter), guide/*, DemoPreview
scripts/smoke.ts, scripts/screenshot.ts
tests/*.test.ts
```

**Pipeline:** validate URL → launch/reuse browser (fresh 1440×900 context, `bypassCSP`, service workers blocked, media and ~40 analytics hosts aborted) → navigate (`domcontentloaded`, then `networkidle` raced against 5s, bot-challenge detection) → dismiss cookie banners → scroll up to 12 steps, grid-sampling backgrounds and taking screenshots → extract → analyse (colours, typography, logo, UI, voice; each step emits a `partial`) → `done`.

**SSRF:** the URL is DNS-resolved up front and rejected if any address is non-public. All Chromium traffic is then forced through a small local forward proxy (`scan/egress.ts`). The proxy resolves each destination itself, refuses private, loopback, link-local and metadata addresses, and connects to the address it just checked. That one check covers redirects, subresources, websockets and DNS rebinding. On top of that, `context.route` aborts iframes, media and known trackers. For the main document it also walks the redirect chain itself, so a redirect to a private address comes back as a clean `blocked_url` error. The font proxy uses the same connect-time lookup and checks font magic bytes.

**Colour roles:** primary is chosen in this order:

1. The strongest chromatic CTA background. CTAs are grouped by colour and weighted by rank. A filled, vivid button only has to be clearly distinct in hue (ΔE ≥ 15), so yellow on white counts.
2. A `--brand/--primary/--accent` CSS variable.
3. A neutral CTA that is neither the background nor the text colour.
4. The most prominent vivid page colour. Colours also defined as CSS variables count triple.
5. The brand mark: the dominant chromatic colour of the logo (SVG fills, or the pixels of the logo image), then of the site icon. Icon pixels are sampled on a canvas from a data: URL fetched through the egress proxy.
6. A monochrome CTA that matches the text colour.
7. The most readable text colour.

Every candidate except vivid filled CTAs must have at least 1.5:1 contrast against the background. Muted always comes from the neutrals, never from a brand-role colour. The demo never uses primary directly as text: a `primaryText` token keeps the hue but shifts OKLCH lightness until it reaches 3:1 against the background (badges are checked against their own tinted background).

Secondary and accent are the next chromatic clusters at least 30° of hue away. Background, surface, text, muted and border come from the sampled neutrals, or are derived (and flagged `derived`) when the page lacks them. Every analysis section is isolated: if one fails, it emits a `warn` step and an empty value instead of ending the scan.

## Limitations

- One page only (the homepage after redirects). There is no crawling, so brand colours that only appear deeper in the site are missed.
- Sites behind Cloudflare, PerimeterX and similar challenges return `bot_protected`. We don't try to evade them.
- Primary-colour picking is heuristic. Monochrome sites (Linear, Vercel) get a neutral primary, which is accurate for those sites but less exciting. Gradient or canvas-heavy heroes are not sampled as colours.
- Logo tiles reverse single-tone logos with a flat CSS filter, so detail inside the mark (Mailchimp's Freddie) becomes a solid shape on the dark tile. Header captures sometimes come out blank while sticky headers animate; those are dropped, so the PNG download can be missing.
- Logo detection scores header/nav images and SVGs. Logos drawn with CSS backgrounds or `<canvas>` are only caught by the PNG fallback, and only when a candidate exists. "Reversed" tiles invert single-tone SVGs with a CSS filter.
- Web fonts are previewed through `/api/font`. Fonts that load only through JS (Typekit kits, for example) or that sit in CSS we couldn't read fall back to the site's font stack. Font licences belong to their owners.
- The egress proxy is per process and listens on 127.0.0.1 without authentication. Another local process could use it, but it only reaches public addresses. It's not hardened for multi-tenant hosting.
- Primary-colour heuristics are tuned on a handful of sites. Vercel now gets its design-system blue (`--ds-blue-700`) rather than black, and Linear gets `--color-indigo`.
- Voice analysis is surface-level: word counts, casing, punctuation, "you" frequency and keyword counts. It doesn't read for meaning.
- Only one Chromium per process, with at most 2 concurrent scans. There is no persistence or caching of results.
