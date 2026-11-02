import { readFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, Page, Response } from "playwright-core";
import {
  analyzeColors,
  analyzeUi,
  analyzeVoice,
  brandName,
  buildImagery,
  buildLogoSet,
  buildTypography,
  parseFontFaces,
  withoutBackground,
} from "../analyze";
import type { ParsedFontFace } from "../analyze/typography";
import { ScanError } from "../errors";
import type {
  BrandGuide,
  IconAsset,
  ImageAsset,
  RawExtraction,
  SampleResult,
  ScanEvent,
  StepId,
  WeightMap,
} from "../types";
import { assertPublicUrl, createHostGuard, normalizeUrl } from "../url";
import { acquireSlot, getBrowser, isServerless } from "./browser";
import { dismissCookieBanners } from "./cookies";
import { getEgressProxyPort } from "./egress";
import { fmt, narrateColors, narrateLogo, narrateTypography, narrateUi, narrateVoice, plural } from "./narrate";

export type Emit = (event: ScanEvent) => void;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const BLOCKED_HOSTS = [
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "googleadservices.com",
  "googlesyndication.com",
  "connect.facebook.net",
  "facebook.com/tr",
  "hotjar.com",
  "segment.com",
  "segment.io",
  "fullstory.com",
  "mixpanel.com",
  "amplitude.com",
  "heap.io",
  "heapanalytics.com",
  "clarity.ms",
  "bat.bing.com",
  "snap.licdn.com",
  "ads-twitter.com",
  "analytics.tiktok.com",
  "quantserve.com",
  "newrelic.com",
  "nr-data.net",
  "browser-intake-datadoghq.com",
  "intercom.io",
  "intercomcdn.com",
  "js.driftt.com",
  "hs-analytics.net",
  "hs-scripts.com",
  "hsadspixel.net",
  "optimizely.com",
  "crazyegg.com",
  "mouseflow.com",
  "pendo.io",
  "sentry.io",
  "rudderstack.com",
  "posthog.com",
  "plausible.io",
];

function loadScript(name: string): string {
  // Read at runtime so the bundler never touches the in-page code.
  const file = path.join(process.cwd(), "src", "lib", "extract", name);
  return readFileSync(file, "utf8").trim().replace(/;\s*$/, "");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mergeWeights(into: WeightMap, from: WeightMap) {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
}

/** Decode an image (data: URL) on a canvas inside the page and count its opaque pixels by colour. */
const SAMPLE_PIXELS = `(function (src, markBg) {
  return new Promise(function (resolve) {
    var img = new Image();
    var done = false;
    var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 3000);
    img.onload = function () {
      if (done) return;
      done = true; clearTimeout(t);
      try {
        var w = 96, h = Math.max(1, Math.min(96, Math.round(96 * (img.naturalHeight || 96) / (img.naturalWidth || 96))));
        var c = document.createElement("canvas"); c.width = w; c.height = h;
        var ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, w, h);
        var d = ctx.getImageData(0, 0, w, h).data, out = {};
        // the dominant opaque colour along the edges is the background behind the mark
        var edge = {}, edgeN = 0, corner = null, cornerN = 0;
        for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
          if (y !== 0 && y !== h - 1 && x !== 0 && x !== w - 1) continue;
          var j = (y * w + x) * 4; edgeN++;
          if (d[j + 3] < 200) continue;
          var ek = "rgb(" + (d[j] & 0xf8) + ", " + (d[j + 1] & 0xf8) + ", " + (d[j + 2] & 0xf8) + ")";
          edge[ek] = (edge[ek] || 0) + 1;
          if (edge[ek] > cornerN) { corner = ek; cornerN = edge[ek]; }
        }
        if (cornerN < edgeN * 0.4) corner = null;
        for (var i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 200) continue;
          var k = "rgb(" + (d[i] & 0xf8) + ", " + (d[i + 1] & 0xf8) + ", " + (d[i + 2] & 0xf8) + ")";
          out[k] = (out[k] || 0) + 1;
        }
        if (markBg && corner && out[corner]) out["__bg__" + corner] = 0;
        resolve(out);
      } catch (e) { resolve(null); }
    };
    img.onerror = function () { if (!done) { done = true; clearTimeout(t); resolve(null); } };
    img.src = src;
  });
})`;

/** markBg: treat the opaque corner colour as the element's background (logo captures, not icons). */
async function samplePixels(page: Page, dataUrl: string | null, markBg = false): Promise<Record<string, number> | null> {
  if (!dataUrl) return null;
  const out = await page.evaluate(`${SAMPLE_PIXELS}(${JSON.stringify(dataUrl)}, ${markBg})`).catch(() => null);
  return out && typeof out === "object" ? (out as Record<string, number>) : null;
}

/** Fetch the best site icon through the (egress-proxied) context and return it as a data: URL. */
async function fetchIconDataUrl(context: BrowserContext, icons: IconAsset[], guard: (u: string) => Promise<boolean>): Promise<string | null> {
  const size = (i: IconAsset) => parseInt(i.sizes ?? "", 10) || (/apple-touch/.test(i.rel) ? 180 : 32);
  const ranked = icons.filter((i) => i.rel !== "og:image" && i.rel !== "mask-icon").sort((a, b) => size(b) - size(a));
  for (const icon of ranked.slice(0, 3)) {
    try {
      if (icon.href.startsWith("data:image/")) return icon.href;
      if (!(await guard(icon.href))) continue;
      const res = await context.request.get(icon.href, { timeout: 4000, maxRedirects: 3 });
      const type = (res.headers()["content-type"] ?? "").split(";")[0].trim();
      if (!res.ok() || !/^image\//.test(type)) continue;
      const body = await res.body();
      if (body.length > 600_000) continue;
      return `data:${type};base64,${body.toString("base64")}`;
    } catch {
      /* try the next icon */
    }
  }
  return null;
}

/** Mark the element that really scrolls (if not the window) and return its scroll height. */
const FIND_SCROLLER = `(function(){
  var winH = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  var best = null, bestH = 0;
  if (winH > window.innerHeight + 50) return winH;
  var els = document.querySelectorAll("body, body *");
  for (var i = 0; i < els.length && i < 4000; i++) {
    var el = els[i];
    if (el.scrollHeight <= el.clientHeight + 50) continue;
    var oy = getComputedStyle(el).overflowY;
    if (oy !== "auto" && oy !== "scroll" && oy !== "overlay") continue;
    var r = el.getBoundingClientRect();
    if (r.width < window.innerWidth * 0.5 || r.height < window.innerHeight * 0.5) continue;
    if (el.scrollHeight > bestH) { best = el; bestH = el.scrollHeight; }
  }
  if (best) { best.setAttribute("data-bs-scroller", "1"); return bestH; }
  return winH;
})()`;

const CHALLENGE_TITLE = /(just a moment|attention required|access denied|verify you are human|are you a robot|security check|pardon our interruption|ddos-guard|one more step)/i;

async function detectChallenge(page: Page, response: Response | null): Promise<string | null> {
  const status = response?.status() ?? 0;
  const info = (await page
    .evaluate(
      `(function(){
        var t = document.title || "";
        var text = document.body ? (document.body.innerText || "").length : 0;
        var frames = Array.prototype.map.call(document.querySelectorAll("iframe"), function (f) { return f.src || ""; }).join(" ");
        return { title: t, textLen: text, frames: frames };
      })()`,
    )
    .catch(() => ({ title: "", textLen: 0, frames: "" }))) as { title: string; textLen: number; frames: string };
  const captcha = /(challenges\.cloudflare\.com|hcaptcha\.com|recaptcha|captcha-delivery\.com|perimeterx|px-captcha|geo\.captcha)/i.test(info.frames);
  if (CHALLENGE_TITLE.test(info.title)) return `challenge page (“${info.title}”)`;
  if ((status === 403 || status === 503 || status === 429) && info.textLen < 1500) return `HTTP ${status} with a near-empty page`;
  if (captcha && info.textLen < 600) return "captcha iframe with no page content";
  return null;
}

export async function runScan(rawUrl: string, emit: Emit, signal: AbortSignal): Promise<void> {
  const started = Date.now();
  let current: { id: StepId; title: string } | null = null;
  const timings: string[] = [];
  let stepStarted = Date.now();
  const log = (msg: string) => console.error(`[scan ${rawUrl}] +${((Date.now() - started) / 1000).toFixed(1)}s ${msg}`);
  let shotPage: Page | null = null;
  /** Screenshot and emit; failed or empty captures are logged and dropped, never sent. */
  const emitShot = async (label: string): Promise<boolean> => {
    if (!shotPage) return false;
    const t0 = Date.now();
    const data = await shot(shotPage);
    log(`shot "${label}" ${data ? `${Math.round((data.length * 3) / 4 / 1024)}KB` : "FAILED"} in ${Date.now() - t0}ms`);
    if (!data) return false;
    emit({ type: "shot", label, data });
    return true;
  };
  const begin = (id: StepId, title: string) => {
    stepStarted = Date.now();
    current = { id, title };
    emit({ type: "step", id, status: "running", title });
  };
  const done = (detail: string, status: "done" | "warn" = "done") => {
    if (!current) return;
    timings.push(`${current.id}=${((Date.now() - stepStarted) / 1000).toFixed(1)}s`);
    emit({ type: "step", id: current.id, status, title: current.title, detail });
    current = null;
  };
  const check = () => {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new ScanError("timeout", "Scan aborted");
  };

  let context: BrowserContext | null = null;
  let release: (() => void) | null = null;
  const onAbort = () => {
    context?.close().catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    /* 1. validate ------------------------------------------------- */
    let url: URL;
    try {
      url = normalizeUrl(rawUrl);
    } catch (e) {
      emit({ type: "start", url: rawUrl });
      throw e;
    }
    emit({ type: "start", url: url.href });
    begin("validate", "Validating URL");
    const addresses = await assertPublicUrl(url);
    done(`${url.hostname} resolves to ${listAddresses(addresses)} — public address${addresses.length === 1 ? "" : "es"}, safe to visit.`);
    check();

    /* 2. browser -------------------------------------------------- */
    begin("browser", "Launching headless browser");
    const slot = await acquireSlot(signal);
    release = slot.release;
    const launchStart = Date.now();
    // A cold serverless launch (extract + start Chromium) must still honour the 90s scan budget.
    const { browser, reused } = await untilAborted(getBrowser(), signal);
    const guard = createHostGuard();
    const proxyPort = await getEgressProxyPort();
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: USER_AGENT,
      locale: "en-US",
      bypassCSP: true,
      serviceWorkers: "block",
      acceptDownloads: false,
      javaScriptEnabled: true,
      // serverless has ~1 vCPU and software rendering: ask sites to stop their animations
      ...(isServerless() ? { reducedMotion: "reduce" as const } : {}),
      // all browser traffic goes through the local egress proxy, which refuses private IPs at connect time
      proxy: { server: `http://127.0.0.1:${proxyPort}` },
    });
    if (signal.aborted) onAbort();
    let blockedRequests = 0;
    let blockedPrivate: string | null = null;
    const page = await context.newPage();
    shotPage = page;
    // lifecycle diagnostics: these show up in `vercel logs` and explain "Target closed" errors
    context.on("close", () => log(`context closed (step ${current?.id ?? "-"})`));
    page.on("crash", () => log(`PAGE CRASHED (step ${current?.id ?? "-"}, url ${page.url()})`));
    page.on("close", () => log(`page closed (step ${current?.id ?? "-"})`));
    browser.once("disconnected", () => log(`BROWSER DISCONNECTED (step ${current?.id ?? "-"})`));
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) log(`main frame → ${f.url().slice(0, 120)}`);
    });
    await context.route("**/*", async (route) => {
      const req = route.request();
      const reqUrl = req.url();
      if (reqUrl.startsWith("data:") || reqUrl.startsWith("blob:")) return route.continue();
      const type = req.resourceType();
      // embedded documents (iframes) add nothing to a brand scan and widen the attack surface
      if (type === "document" && req.frame() !== page.mainFrame()) {
        blockedRequests++;
        return route.abort("blockedbyclient").catch(() => undefined);
      }
      if (type === "media" || BLOCKED_HOSTS.some((h) => reqUrl.includes(h))) {
        blockedRequests++;
        return route.abort("blockedbyclient").catch(() => undefined);
      }
      const isMainNav = req.isNavigationRequest() && req.frame() === page.mainFrame();
      if (!(await guard(reqUrl))) {
        blockedRequests++;
        if (isMainNav) blockedPrivate = reqUrl;
        return route.abort("blockedbyclient").catch(() => undefined);
      }
      if (isMainNav) {
        // Chromium follows redirects without re-entering this handler, so walk the redirect
        // chain ourselves (no auto-follow) and check every hop before letting the browser go.
        try {
          const first = await route.fetch({ maxRedirects: 0, timeout: 20_000 });
          let res = first;
          let hopUrl = reqUrl;
          for (let hop = 0; hop < 8 && res.status() >= 300 && res.status() < 400; hop++) {
            const location = res.headers()["location"];
            if (!location) break;
            hopUrl = new URL(location, hopUrl).href;
            if (!(await guard(hopUrl))) {
              blockedRequests++;
              blockedPrivate = hopUrl;
              return route.abort("blockedbyclient").catch(() => undefined);
            }
            res = await context!.request.fetch(hopUrl, { maxRedirects: 0, timeout: 20_000, headers: { "user-agent": USER_AGENT } });
          }
          return route.fulfill({ response: first }).catch(() => undefined);
        } catch {
          return route.continue().catch(() => undefined);
        }
      }
      return route.continue().catch(() => undefined);
    });
    // collect stylesheet text for @font-face + :root variables in cross-origin sheets
    const cssTexts: Array<Promise<{ url: string; text: string } | null>> = [];
    page.on("response", (res) => {
      if (res.request().resourceType() !== "stylesheet" || cssTexts.length >= 40) return;
      cssTexts.push(
        res
          .text()
          .then((text) => ({ url: res.url(), text: text.slice(0, 3_000_000) }))
          .catch(() => null),
      );
    });
    done(
      `${reused ? "Reused the warm Chromium instance" : "Started Chromium"} in ${fmt(Date.now() - launchStart)}ms${slot.waitedMs > 50 ? ` after queueing ${fmt(slot.waitedMs)}ms` : ""}; fresh 1440×900 context with media and ${BLOCKED_HOSTS.length} analytics hosts blocked.`,
    );
    check();

    /* 3. navigate ------------------------------------------------- */
    begin("navigate", `Opening ${url.hostname}`);
    const navStart = Date.now();
    let response: Response | null;
    try {
      response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (e) {
      check();
      if (blockedPrivate) throw new ScanError("blocked_url", `The site redirected to a private address (${blockedPrivate}).`);
      const msg = e instanceof Error ? e.message : String(e);
      if (/ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED/.test(msg)) {
        throw new ScanError("blocked_url", "The site (or a redirect) points to a private or unreachable address.");
      }
      if (/Timeout/i.test(msg)) throw new ScanError("timeout", "The page did not finish loading within 30 seconds.");
      throw new ScanError("nav_failed", `Navigation failed: ${msg.split("\n")[0].replace(/^page\.goto: /, "")}`);
    }
    if (blockedPrivate) throw new ScanError("blocked_url", `The site redirected to a private address (${blockedPrivate}).`);
    // Defence in depth: re-check every hop of the redirect chain.
    for (let r = response?.request() ?? null; r; r = r.redirectedFrom()) {
      if (!(await guard(r.url()))) throw new ScanError("blocked_url", `Redirect through a private address (${r.url()}).`);
    }
    const networkIdle = await Promise.race([
      page.waitForLoadState("networkidle").then(() => true, () => false),
      sleep(5000).then(() => false),
    ]);
    check();
    const challenge = await detectChallenge(page, response);
    if (challenge) throw new ScanError("bot_protected", `Blocked by bot protection: ${challenge}.`);
    const status = response?.status() ?? 0;
    if (status >= 400) throw new ScanError("nav_failed", `The site answered with HTTP ${status}.`);
    const finalUrl = page.url();
    const redirected = new URL(finalUrl).href !== url.href;
    const initialShot = await emitShot("Initial viewport");
    done(
      `HTTP ${status} in ${fmt(Date.now() - navStart)}ms${redirected ? `, redirected to ${new URL(finalUrl).host}${new URL(finalUrl).pathname}` : ""}; network ${networkIdle ? "went idle" : "still busy after 5s, moving on"}${blockedRequests ? `; blocked ${plural(blockedRequests, "tracker/media request")}` : ""}.`,
    );
    check();

    /* 4. cookies -------------------------------------------------- */
    begin("cookies", "Dismissing cookie banners");
    const cookie = await dismissCookieBanners(page);
    done(`${cookie.detail}${cookie.hidden && cookie.method !== "overlay" ? `, then hid ${plural(cookie.hidden, "leftover overlay")}` : ""}.`);
    check();

    /* 5. scroll + sample ----------------------------------------- */
    begin("scroll", "Scrolling for lazy-loaded content");
    const sampler = loadScript("sampler.js");
    const sample = async (): Promise<SampleResult> =>
      (await page.evaluate(`(${sampler})({ cols: 24, rows: 15 })`)) as SampleResult;
    const bgColors: WeightMap = {};
    let samplePoints = 0;
    let viewports = 0;
    const first = await sample();
    mergeWeights(bgColors, first.colors);
    samplePoints += first.points;
    viewports++;
    // Some sites scroll an inner wrapper (body or a full-height div) instead of the window.
    const docHeight = Number(await page.evaluate(FIND_SCROLLER)) || 900;
    const scrollTo = (y: number) =>
      page.evaluate(`(function(y){var el=document.querySelector("[data-bs-scroller]"); if (el) el.scrollTop=y; else window.scrollTo(0,y);})(${y})`);
    const scrollHeight = async () => Number(await page.evaluate(`(function(){var el=document.querySelector("[data-bs-scroller]"); return el ? el.scrollHeight : Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);})()`)) || docHeight;
    const stepPx = Math.round(900 * 0.85);
    // Serverless renders in software on ~1 vCPU: fewer steps and one mid-scroll shot keep scans well
    // inside the 90s budget. Locally we can afford the full sweep.
    const lean = isServerless();
    const steps = Math.min(lean ? 8 : 12, Math.max(1, Math.ceil((docHeight - 900) / stepPx)));
    const shotAt = new Set(
      (lean ? [Math.round(steps * 0.5)] : [Math.round(steps * 0.25), Math.round(steps * 0.5), Math.round(steps * 0.75), steps]).filter((n) => n >= 1),
    );
    let shots = initialShot ? 1 : 0;
    for (let i = 1; i <= steps; i++) {
      check();
      await scrollTo(i * stepPx);
      await sleep(250);
      const s = await sample().catch(() => null);
      if (s) {
        mergeWeights(bgColors, s.colors);
        samplePoints += s.points;
        viewports++;
      }
      if (shotAt.has(i) && shots < 4) {
        const pct = Math.min(100, Math.round(((i * stepPx + 900) / docHeight) * 100));
        if (await emitShot(`Scrolled ${pct}%`)) shots++;
      }
    }
    await scrollTo(0);
    await sleep(350);
    // finish on the hero again so the panel ends on the recognisable view, not the footer
    if (await emitShot("Back to top")) shots++;
    const newHeight = await scrollHeight();
    const covered = Math.min(newHeight, steps * stepPx + 900);
    const coverPct = Math.round((covered / Math.max(newHeight, 1)) * 100);
    done(
      `Scrolled ${plural(steps, "step")}, covering ${fmt(covered)}px of a ${fmt(newHeight)}px page (${coverPct}%${coverPct < 100 ? (steps >= (lean ? 8 : 12) ? `, capped at ${steps} steps` : ", the rest loaded after the last step") : ""})${newHeight > docHeight + 200 ? `; it grew from ${fmt(docHeight)}px as content lazy-loaded` : ""}. Sampled ${fmt(samplePoints)} background points and captured ${plural(shots, "screenshot")}.`,
    );
    check();

    /* 6. extract -------------------------------------------------- */
    begin("extract", "Extracting styles from the DOM");
    const extractor = loadScript("extractor.js");
    const raw = (await page.evaluate(`(${extractor})({ maxElements: 6000 })`)) as RawExtraction;
    raw.bgColors = bgColors;
    const inlineCss = String(
      await page.evaluate("Array.prototype.map.call(document.querySelectorAll('style'), function (s) { return s.textContent || ''; }).join('\\n').slice(0, 3000000)"),
    );
    const sheets = (await Promise.all(cssTexts)).filter((s): s is { url: string; text: string } => !!s);
    const parsedFaces: ParsedFontFace[] = [
      ...parseFontFaces(inlineCss, finalUrl),
      ...sheets.flatMap((s) => parseFontFaces(s.text, s.url)),
      // CSSOM fallback: covers sheets whose network body we didn't capture (parallel-run races)
      ...(raw.fontFaceRules ?? []).flatMap((r) => parseFontFaces(r.css, r.base)),
    ];
    const extraVars = [inlineCss, ...sheets.map((s) => s.text)].reduce<Record<string, string>>((acc, css) => Object.assign(acc, parseRootVars(css)), {});
    for (const [k, v] of Object.entries(extraVars)) if (!(k in raw.cssVars)) raw.cssVars[k] = v;

    // PNG capture of the top logo candidate. Sticky headers can still be animating back in after
    // the scroll, giving a blank capture, so retry once and drop captures with no visible mark.
    let pngLogo: string | null = null;
    let logoPixels: Record<string, number> | null = null;
    if (raw.logos.length) {
      for (let attempt = 0; attempt < 2 && !pngLogo; attempt++) {
        if (attempt) await sleep(800);
        const buf = await page
          .locator("[data-bs-logo]")
          .first()
          .screenshot({ type: "png", omitBackground: true, timeout: 3000, animations: "disabled" })
          .catch(() => null);
        if (!buf) continue;
        const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
        const px = await samplePixels(page, dataUrl, true);
        if (px && Object.keys(withoutBackground(px)).length > 0) {
          pngLogo = dataUrl;
          logoPixels = px;
        }
      }
    }
    // For <img> logos, the image file itself is the best source for its tone (transparent pixels
    // are skipped), and it is exactly what the guideline tiles display.
    const topLogo = raw.logos[0];
    if (topLogo?.kind === "img" && topLogo.src) {
      const imgData = await fetchIconDataUrl(context, [{ rel: "logo", href: topLogo.src, sizes: "999" }], guard);
      const px = await samplePixels(page, imgData, false);
      // "__bg__none": transparent file, nothing to strip as backdrop
      if (px && Object.keys(px).length) logoPixels = { ...px, __bg__none: 0 };
    }
    const manifestIcons = raw.manifestUrl ? await fetchManifestIcons(context, raw.manifestUrl, guard) : [];
    // brand-mark pixels: logo capture (raster logos, tile tone) and the site icon (colour fallback)
    const iconPixels = await samplePixels(page, await fetchIconDataUrl(context, [...raw.icons, ...manifestIcons], guard));
    done(
      `Walked ${fmt(raw.textElementCount)} text elements: ${plural(Object.keys(raw.textColors).length, "text colour")}, ${plural(raw.buttons.length, "button")}, ${plural(Object.keys(raw.cssVars).length, "CSS variable")}, ${plural(raw.fontFaces.length, "loaded font face")}, ${plural(raw.logos.length, "logo candidate")} and ${plural(raw.images.length, "large image")}.`,
    );
    check();

    /* 7. analyse -------------------------------------------------- */
    const domain = new URL(finalUrl).hostname.replace(/^www\./, "");

    // Each analysis section is isolated: a failure degrades that section (warn step + empty
    // value) instead of killing the whole scan.
    const section = <T,>(compute: () => T, fallback: T, narrate: (v: T) => string, ok: (v: T) => boolean = () => true): T => {
      try {
        const value = compute();
        done(narrate(value), ok(value) ? "done" : "warn");
        return value;
      } catch (e) {
        console.error(`[scan] ${current?.id ?? "analysis"} failed`, e);
        done(`Couldn't analyse this part of the page (${e instanceof Error ? e.message.slice(0, 120) : "unknown error"}); showing what we have.`, "warn");
        return fallback;
      }
    };

    begin("colors", "Clustering colours");
    const colors = section(
      () => analyzeColors(raw, samplePoints, { logo: logoPixels, icon: iconPixels }),
      { roles: [], all: [], pairs: [], samplePoints },
      (c) => narrateColors(c, viewports),
    );
    emit({ type: "partial", key: "colors", value: colors });

    begin("typography", "Identifying typography");
    const typography = section(
      () =>
        buildTypography({
          families: raw.families,
          headingFamilies: raw.headingFamilies,
          fontFaces: raw.fontFaces,
          typeSamples: raw.typeSamples,
          parsedFaces,
        }),
      { families: [], headingFamily: "system-ui", bodyFamily: "system-ui", scale: [], ratio: null, baseSize: 16 },
      narrateTypography,
      (t) => t.families.length > 0,
    );
    emit({ type: "partial", key: "typography", value: typography });

    begin("logo", "Scoring logo candidates");
    const logo = section(
      () => buildLogoSet(raw, pngLogo, manifestIcons, logoPixels),
      { primary: null, alternates: [], icons: [] },
      (l) => narrateLogo(l, raw.logos.length),
      (l) => !!l.primary || l.icons.length > 0,
    );
    emit({ type: "partial", key: "logo", value: logo });

    begin("ui", "Measuring UI elements");
    let imagery: ImageAsset[] = [];
    try {
      imagery = buildImagery(raw);
    } catch {
      imagery = [];
    }
    const ui = section(
      () => analyzeUi(raw, colors.roles),
      { primaryButton: null, secondaryButton: null, link: null, radius: [], spacing: [], shadows: [] },
      (u) => narrateUi(u, imagery.length),
    );
    emit({ type: "partial", key: "ui", value: ui });
    emit({ type: "partial", key: "imagery", value: imagery });

    begin("voice", "Reading voice & tone");
    const voice = section(
      () =>
        analyzeVoice({
          title: raw.title,
          description: raw.description,
          h1: raw.h1,
          headings: raw.headings,
          ctas: raw.ctaLabels,
          paragraphs: raw.paragraphs,
        }),
      {
        title: raw.title,
        description: raw.description,
        headline: raw.h1[0] ?? raw.title,
        headings: [],
        ctas: [],
        keywords: [],
        traits: [],
        stats: { avgHeadlineWords: 0, caseStyle: "mixed", exclamationRate: 0, youRate: 0 },
      },
      narrateVoice,
    );
    emit({ type: "partial", key: "voice", value: voice });

    /* 8. done ----------------------------------------------------- */
    begin("finalize", "Assembling brand guideline");
    const brand: BrandGuide = {
      url: url.href,
      finalUrl,
      domain,
      name: brandName(raw, domain),
      scannedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      logo,
      colors,
      typography,
      ui,
      imagery,
      voice,
    };
    done(`Guideline for ${brand.name} ready in ${(brand.durationMs / 1000).toFixed(1)}s.`);
    emit({ type: "done", brand });
  } catch (err) {
    const scanErr = toScanError(err, signal);
    log(`FAILED at ${(current as { id: StepId } | null)?.id ?? "-"}: ${scanErr.code} ${err instanceof Error ? (err.stack ?? err.message).slice(0, 800) : String(err)}`);
    if (current) done(scanErr.message, "warn");
    emit({ type: "error", code: scanErr.code, message: scanErr.message });
  } finally {
    log(`timings ${timings.join(" ")} total=${((Date.now() - started) / 1000).toFixed(1)}s`);
    signal.removeEventListener("abort", onAbort);
    await context?.close().catch(() => undefined);
    release?.();
  }
}

/** Reject as soon as `signal` aborts, even if `p` never settles (e.g. a hung browser launch). */
function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function toScanError(err: unknown, signal: AbortSignal): ScanError {
  if (err instanceof ScanError) return err;
  if (signal.aborted) {
    const reason = signal.reason;
    if (reason instanceof DOMException && reason.name === "TimeoutError") {
      return new ScanError("timeout", "The scan took longer than 90 seconds and was stopped.");
    }
    return new ScanError("timeout", "The scan was cancelled.");
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/Target page, context or browser has been closed/i.test(msg)) return new ScanError("timeout", "The scan was stopped before it finished.");
  console.error("[scan] internal error", err);
  return new ScanError("internal", "Unexpected error while scanning the page.");
}

function listAddresses(addresses: string[]): string {
  const shown = addresses.slice(0, 2).join(", ");
  return addresses.length > 2 ? `${shown} (+${addresses.length - 2} more)` : shown;
}

async function shot(page: Page): Promise<string> {
  const buf = await page
    .screenshot({ type: "jpeg", quality: 60, timeout: 8000, animations: "disabled", caret: "hide" })
    .catch((e) => {
      console.error(`[scan] screenshot failed: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      return null;
    });
  return buf ? buf.toString("base64") : "";
}

/** Custom properties declared on :root / html / body in a stylesheet's text. */
export function parseRootVars(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(^|})\s*((?::root|html|body)(?:\s*,\s*(?::root|html|body|\.[\w-]+|\[[^\]]+\]))*)\s*{([^}]*)}/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(css)) && n < 600) {
    for (const decl of m[3].split(";")) {
      const idx = decl.indexOf(":");
      if (idx < 0) continue;
      const name = decl.slice(0, idx).trim();
      const value = decl.slice(idx + 1).trim();
      if (name.startsWith("--") && value && value.length < 120 && !value.includes("var(") && !(name in out)) {
        out[name] = value;
        n++;
      }
    }
  }
  return out;
}

async function fetchManifestIcons(context: BrowserContext, manifestUrl: string, guard: (u: string) => Promise<boolean>): Promise<IconAsset[]> {
  try {
    if (!(await guard(manifestUrl))) return [];
    const res = await context.request.get(manifestUrl, { timeout: 4000, maxRedirects: 0 });
    if (!res.ok()) return [];
    const json = (await res.json()) as { icons?: Array<{ src?: string; sizes?: string }> };
    return (json.icons ?? [])
      .filter((i) => i.src)
      .slice(0, 4)
      .map((i) => ({ rel: "manifest", href: new URL(i.src!, manifestUrl).href, sizes: i.sizes }));
  } catch {
    return [];
  }
}
