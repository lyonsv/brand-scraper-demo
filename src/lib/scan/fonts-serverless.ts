// Serverless only. @sparticuz/chromium bundles a single font (Open Sans: Latin, Greek, Cyrillic),
// so emoji and CJK text in screenshots would render as tofu boxes. Its fontconfig also scans
// /tmp/fonts, so on a cold start we download a small set of fallback fonts there before
// launching Chromium. Sites' own web fonts still load normally through the page.
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const FONT_DIR = "/tmp/fonts";

/** Fixed, version-pinned URLs (operator-controlled, never user input). */
const DEFAULT_FONTS = [
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2.047/fonts/NotoColorEmoji.ttf", // ~10.6 MB
  "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf", // ~8.3 MB, Han + kana
];

/** BS_FONT_URLS overrides the list (comma-separated https URLs); set it to "" to skip downloads. */
export function fontUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.BS_FONT_URLS;
  const list = raw === undefined ? DEFAULT_FONTS : raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.filter((u) => u.startsWith("https://"));
}

let ready: Promise<void> | null = null;

async function download(url: string): Promise<void> {
  const file = path.join(FONT_DIR, path.basename(new URL(url).pathname));
  if (await stat(file).then((s) => s.size > 0, () => false)) return;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok || !res.body) throw new Error(`font download failed: ${res.status}`);
  const tmp = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(tmp));
  await rename(tmp, file);
}

/** Download fallback fonts once per instance. Never throws: missing fonts only cost glyph coverage. */
export function ensureServerlessFonts(): Promise<void> {
  ready ??= (async () => {
    await mkdir(FONT_DIR, { recursive: true });
    const results = await Promise.allSettled(fontUrls().map(download));
    for (const r of results) if (r.status === "rejected") console.warn("[fonts] fallback font unavailable:", r.reason);
  })().catch((e) => console.warn("[fonts] skipped:", e));
  return ready;
}
