import { chromium, type Browser } from "playwright";

interface BrowserState {
  browser: Promise<Browser> | null;
  active: number;
  queue: Array<() => void>;
}

const MAX_CONCURRENT = 2;

// Survive Next.js dev hot reloads: keep one Chromium per server process.
const g = globalThis as typeof globalThis & { __brandScraperBrowser?: BrowserState };
const state: BrowserState = (g.__brandScraperBrowser ??= { browser: null, active: 0, queue: [] });

export function getBrowser(): Promise<{ browser: Browser; reused: boolean }> {
  const reused = state.browser !== null;
  if (!state.browser) {
    state.browser = chromium
      .launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-default-browser-check"] })
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

/** Wait for one of MAX_CONCURRENT job slots. Returns a release function and how long we queued. */
export async function acquireSlot(signal: AbortSignal): Promise<{ release: () => void; waitedMs: number; queuedBehind: number }> {
  const started = Date.now();
  const queuedBehind = state.active >= MAX_CONCURRENT ? state.queue.length + 1 : 0;
  if (state.active >= MAX_CONCURRENT) {
    // Wait for a slot to be handed over directly by release() (active count unchanged).
    await new Promise<void>((resolve, reject) => {
      const go = () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        const idx = state.queue.indexOf(go);
        if (idx >= 0) state.queue.splice(idx, 1);
        reject(signal.reason ?? new Error("aborted"));
      };
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
