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

export function serverlessArgs(base: string[]): string[] {
  return base.filter((a) => !UNSAFE_SERVERLESS_FLAGS.includes(a.split("=")[0]));
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
  await ensureServerlessFonts();
  return chromium.launch({
    headless: true,
    timeout: 30_000,
    executablePath: await Sparticuz.executablePath(),
    args: serverlessArgs(Sparticuz.args),
  });
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
