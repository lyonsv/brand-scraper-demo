import { chromium, type Browser } from "playwright-core";
import { ScanError } from "../errors";

interface BrowserState {
  browser: Promise<Browser> | null;
  active: number;
  queue: Array<() => void>;
}

const MAX_CONCURRENT = 2;
/** On Vercel a queued request burns function time, so fail fast with `busy`; locally, queue. */
export const MAX_QUEUE_WAIT_MS = process.env.VERCEL ? 3_000 : 60_000;

export const isServerless = (): boolean => !!process.env.VERCEL;

// Survive Next.js dev hot reloads / warm serverless instances: one Chromium per process.
const g = globalThis as typeof globalThis & { __brandScraperBrowser?: BrowserState };
const state: BrowserState = (g.__brandScraperBrowser ??= { browser: null, active: 0, queue: [] });

/**
 * Flags from @sparticuz/chromium that would relax browser security. Pages we scan are untrusted,
 * so we keep the same-origin policy, mixed-content blocking and site isolation that local runs have.
 */
export const UNSAFE_SERVERLESS_FLAGS = ["--disable-web-security", "--allow-running-insecure-content", "--disable-site-isolation-trials"];

/**
 * `--single-process` is dropped too: in single-process mode, closing a scan's browser context
 * tears down the whole browser, so the next scan on a warm instance got "Target page, context or
 * browser has been closed" from a dead shared browser. Multi-process Chromium runs fine on
 * Vercel's Node runtime (verified on preview deploys: bechtle.de then stripe.com on one instance).
 */
export const DROPPED_SERVERLESS_FLAGS = ["--single-process"];

/**
 * Added on serverless: there's no GPU, so WebGL/3D is rendered by SwiftShader on ~1 vCPU. Decorative
 * WebGL heroes (e.g. stripe.com's animated gradient) then starve the renderer, and screenshots
 * time out at 8s while each scroll step takes 5–15s. Brand extraction doesn't need WebGL.
 */
export const EXTRA_SERVERLESS_FLAGS = ["--disable-3d-apis"];

export function serverlessArgs(base: string[]): string[] {
  const drop = [...UNSAFE_SERVERLESS_FLAGS, ...DROPPED_SERVERLESS_FLAGS];
  return [...base.filter((a) => !drop.includes(a.split("=")[0])), ...EXTRA_SERVERLESS_FLAGS];
}

async function launch(): Promise<Browser> {
  if (!isServerless()) {
    // Local: the Chromium build installed by `pnpm exec playwright install chromium`.
    return chromium.launch({ headless: true, timeout: 60_000, args: ["--disable-dev-shm-usage", "--no-default-browser-check"] });
  }
  // Vercel (Linux, no system Chromium): the brotli-packed build from @sparticuz/chromium,
  // version-matched to playwright-core (Chromium 153 ↔ playwright-core 1.63). Loaded lazily so
  // local dev never touches it.
  const [{ default: Sparticuz }, { ensureServerlessFonts }] = await Promise.all([import("@sparticuz/chromium"), import("./fonts-serverless")]);
  // ORDER MATTERS: executablePath() unpacks fonts.tar.br (fonts.conf + Open Sans) into /tmp/fonts,
  // but skips it if /tmp/fonts already exists. Creating that directory first (for our fallback
  // fonts) left Chromium with no fontconfig config at all, and single-process Chromium then
  // aborted on the first font fallback (FATAL SkFontMgr_FontConfigInterface.cpp "Not implemented").
  const executablePath = await Sparticuz.executablePath();
  await ensureServerlessFonts();
  // Diagnostics / experiments for preview deploys (never needed in production):
  //   BS_DEBUG=1                 log Chromium's stderr and protocol-level browser events
  //   BS_CHROMIUM_DROP=--a,--b   drop flags from the @sparticuz set
  //   BS_CHROMIUM_ADD=--c,--d    append flags
  const list = (v: string | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const drop = list(process.env.BS_CHROMIUM_DROP);
  const args = [...serverlessArgs(Sparticuz.args).filter((a) => !drop.includes(a.split("=")[0])), ...list(process.env.BS_CHROMIUM_ADD)];
  console.error(`[chromium] launching (debug=${process.env.BS_DEBUG ?? "off"}) with ${args.join(" ")}`);
  const browser = await chromium.launch({
    headless: true,
    timeout: 30_000,
    executablePath,
    args,
    logger:
      process.env.BS_DEBUG === "1"
        ? { isEnabled: (name) => name === "browser", log: (name, _sev, message) => console.error(`[pw:${name}] ${String(message).slice(0, 500)}`) }
        : undefined,
  });
  browser.on("disconnected", () => console.error("[chromium] browser disconnected"));
  return browser;
}

export function getBrowser(): Promise<{ browser: Browser; reused: boolean }> {
  const reused = state.browser !== null;
  if (!state.browser) {
    state.browser = launch()
      .then((b) => {
        b.on("disconnected", () => {
          state.browser = null;
        });
        return b;
      })
      .catch((err) => {
        state.browser = null;
        throw err;
      });
  }
  return state.browser.then(async (browser) => {
    if (!browser.isConnected()) {
      state.browser = null;
      return getBrowser();
    }
    return { browser, reused };
  });
}

/**
 * Wait for one of MAX_CONCURRENT job slots. Gives up with a `busy` error after `maxWaitMs`.
 * Returns a release function and how long we queued.
 */
export async function acquireSlot(
  signal: AbortSignal,
  maxWaitMs = MAX_QUEUE_WAIT_MS,
): Promise<{ release: () => void; waitedMs: number; queuedBehind: number }> {
  const started = Date.now();
  const queuedBehind = state.active >= MAX_CONCURRENT ? state.queue.length + 1 : 0;
  if (state.active >= MAX_CONCURRENT) {
    // Wait for a slot to be handed over directly by release() (active count unchanged).
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        const idx = state.queue.indexOf(go);
        if (idx >= 0) state.queue.splice(idx, 1);
      };
      const go = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(signal.reason ?? new Error("aborted"));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new ScanError("busy", "Two scans are already running here. Try again in a minute."));
      }, maxWaitMs);
      state.queue.push(go);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  } else {
    state.active++;
  }
  let released = false;
  return {
    waitedMs: Date.now() - started,
    queuedBehind,
    release: () => {
      if (released) return;
      released = true;
      const next = state.queue.shift();
      if (next) next();
      else state.active--;
    },
  };
}
