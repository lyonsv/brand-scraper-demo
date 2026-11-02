import { readFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, Page, Response } from "playwright";
import {
  analyzeColors,
  analyzeUi,
  analyzeVoice,
  brandName,
  buildImagery,
  buildLogoSet,
  buildTypography,
  parseFontFaces,
} from "../analyze";
import type { ParsedFontFace } from "../analyze/typography";
import { ScanError } from "../errors";
import type {
  BrandGuide,
  IconAsset,
  RawExtraction,
  SampleResult,
  ScanEvent,
  StepId,
  WeightMap,
} from "../types";
import { assertPublicUrl, createHostGuard, normalizeUrl } from "../url";
import { acquireSlot, getBrowser } from "./browser";
import { dismissCookieBanners } from "./cookies";
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
  const begin = (id: StepId, title: string) => {
    current = { id, title };
    emit({ type: "step", id, status: "running", title });
  };
  const done = (detail: string, status: "done" | "warn" = "done") => {
    if (!current) return;
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
    const { browser, reused } = await getBrowser();
    const guard = createHostGuard();
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: USER_AGENT,
      locale: "en-US",
      bypassCSP: true,
      serviceWorkers: "block",
      acceptDownloads: false,
      javaScriptEnabled: true,
    });
    if (signal.aborted) onAbort();
    let blockedRequests = 0;
    let blockedPrivate: string | null = null;
    const page = await context.newPage();
    await context.route("**/*", async (route) => {
      const req = route.request();
      const reqUrl = req.url();
      if (reqUrl.startsWith("data:") || reqUrl.startsWith("blob:")) return route.continue();
      const type = req.resourceType();
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
    emit({ type: "shot", label: "Initial viewport", data: await shot(page) });
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
    const docHeight = Number(await page.evaluate("Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)")) || 900;
    const stepPx = Math.round(900 * 0.85);
    const steps = Math.min(12, Math.max(1, Math.ceil((docHeight - 900) / stepPx)));
    const shotAt = new Set([Math.round(steps * 0.25), Math.round(steps * 0.5), Math.round(steps * 0.75), steps].filter((n) => n >= 1));
    let shots = 1;
    for (let i = 1; i <= steps; i++) {
      check();
      await page.evaluate(`window.scrollTo(0, ${i * stepPx})`);
      await sleep(250);
      const s = await sample().catch(() => null);
      if (s) {
        mergeWeights(bgColors, s.colors);
        samplePoints += s.points;
        viewports++;
      }
      if (shotAt.has(i) && shots < 5) {
        const pct = Math.min(100, Math.round(((i * stepPx + 900) / docHeight) * 100));
        emit({ type: "shot", label: `Scrolled ${pct}%`, data: await shot(page) });
        shots++;
      }
    }
    await page.evaluate("window.scrollTo(0, 0)");
    await sleep(350);
    const newHeight = Number(await page.evaluate("document.documentElement.scrollHeight")) || docHeight;
    done(
      `Scrolled ${plural(steps, "step")} through ${fmt(newHeight)}px of page${newHeight > docHeight + 200 ? ` (grew from ${fmt(docHeight)}px as content lazy-loaded)` : ""}, sampling ${fmt(samplePoints)} background points and capturing ${plural(shots, "screenshot")}.`,
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
    const parsedFaces: ParsedFontFace[] = [...parseFontFaces(inlineCss, finalUrl), ...sheets.flatMap((s) => parseFontFaces(s.text, s.url))];
    const extraVars = [inlineCss, ...sheets.map((s) => s.text)].reduce<Record<string, string>>((acc, css) => Object.assign(acc, parseRootVars(css)), {});
    for (const [k, v] of Object.entries(extraVars)) if (!(k in raw.cssVars)) raw.cssVars[k] = v;

    let pngLogo: string | null = null;
    if (raw.logos.length) {
      const buf = await page
        .locator("[data-bs-logo]")
        .first()
        .screenshot({ type: "png", omitBackground: true, timeout: 3000 })
        .catch(() => null);
      if (buf) pngLogo = `data:image/png;base64,${buf.toString("base64")}`;
    }
    const manifestIcons = raw.manifestUrl ? await fetchManifestIcons(context, raw.manifestUrl, guard) : [];
    done(
      `Walked ${fmt(raw.textElementCount)} text elements: ${plural(Object.keys(raw.textColors).length, "text colour")}, ${plural(raw.buttons.length, "button")}, ${plural(Object.keys(raw.cssVars).length, "CSS variable")}, ${plural(raw.fontFaces.length, "loaded font face")}, ${plural(raw.logos.length, "logo candidate")} and ${plural(raw.images.length, "large image")}.`,
    );
    check();

    /* 7. analyse -------------------------------------------------- */
    const domain = new URL(finalUrl).hostname.replace(/^www\./, "");

    begin("colors", "Clustering colours");
    const colors = analyzeColors(raw, samplePoints);
    emit({ type: "partial", key: "colors", value: colors });
    done(narrateColors(colors, viewports));

    begin("typography", "Identifying typography");
    const typography = buildTypography({
      families: raw.families,
      headingFamilies: raw.headingFamilies,
      fontFaces: raw.fontFaces,
      typeSamples: raw.typeSamples,
      parsedFaces,
    });
    emit({ type: "partial", key: "typography", value: typography });
    done(narrateTypography(typography), typography.families.length ? "done" : "warn");

    begin("logo", "Scoring logo candidates");
    const logo = buildLogoSet(raw, pngLogo, manifestIcons);
    emit({ type: "partial", key: "logo", value: logo });
    done(narrateLogo(logo, raw.logos.length), logo.primary || logo.icons.length ? "done" : "warn");

    begin("ui", "Measuring UI elements");
    const ui = analyzeUi(raw, colors.roles);
    const imagery = buildImagery(raw);
    emit({ type: "partial", key: "ui", value: ui });
    emit({ type: "partial", key: "imagery", value: imagery });
    done(narrateUi(ui, imagery.length));

    begin("voice", "Reading voice & tone");
    const voice = analyzeVoice({
      title: raw.title,
      description: raw.description,
      h1: raw.h1,
      headings: raw.headings,
      ctas: raw.ctaLabels,
      paragraphs: raw.paragraphs,
    });
    emit({ type: "partial", key: "voice", value: voice });
    done(narrateVoice(voice));

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
    if (current) done(scanErr.message, "warn");
    emit({ type: "error", code: scanErr.code, message: scanErr.message });
  } finally {
    signal.removeEventListener("abort", onAbort);
    await context?.close().catch(() => undefined);
    release?.();
  }
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
  const buf = await page.screenshot({ type: "jpeg", quality: 60, timeout: 8000 }).catch(() => null);
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
