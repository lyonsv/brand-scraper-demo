/**
 * End-to-end smoke test: streams POST /api/scan against a running dev server and asserts the
 * final `done` event carries a primary colour, at least one font and a logo or icon.
 *
 *   pnpm smoke stripe.com [linear.app ...]
 *   BASE_URL=http://localhost:3210 pnpm smoke example.com
 *
 * Pass --allow-error to treat a clean `error` event (e.g. bot_protected) as a pass, and
 * --allow-minimal to accept a `done` without a logo/icon (bare pages such as example.com).
 */
import type { BrandGuide, ScanEvent } from "../src/lib/types";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3210";
const args = process.argv.slice(2);
const allowError = args.includes("--allow-error");
const allowMinimal = args.includes("--allow-minimal");
const targets = args.filter((a) => !a.startsWith("--"));

interface Outcome {
  target: string;
  ok: boolean;
  summary: string;
}

async function scan(target: string): Promise<Outcome> {
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/api/scan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: target }),
  });
  if (!res.ok || !res.body) return { target, ok: false, summary: `HTTP ${res.status}` };
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("application/x-ndjson")) return { target, ok: false, summary: `unexpected content-type ${ctype}` };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let brand: BrandGuide | null = null;
  let error: { code: string; message: string } | null = null;
  const counts: Record<string, number> = {};
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = JSON.parse(line) as ScanEvent;
      counts[event.type] = (counts[event.type] ?? 0) + 1;
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
      if (event.type === "step" && event.status !== "running") {
        console.log(`  ${elapsed}s ${event.status === "done" ? "✓" : "⚠"} ${event.title}${event.detail ? ` — ${event.detail}` : ""}`);
      } else if (event.type === "shot") {
        console.log(`  ${elapsed}s 📷 ${event.label} (${Math.round((event.data.length * 3) / 4 / 1024)} KB)`);
      } else if (event.type === "partial") {
        console.log(`  ${elapsed}s ◆ partial: ${event.key}`);
      } else if (event.type === "done") {
        brand = event.brand;
      } else if (event.type === "error") {
        error = { code: event.code, message: event.message };
      }
    }
  }
  const tally = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(" ");
  if (error) {
    return { target, ok: allowError, summary: `error ${error.code}: ${error.message} [${tally}]` };
  }
  if (!brand) return { target, ok: false, summary: `stream ended without done [${tally}]` };
  const primary = brand.colors.roles.find((r) => r.role === "primary");
  const fonts = brand.typography.families;
  const hasLogo = !!brand.logo.primary || brand.logo.icons.length > 0;
  const problems: string[] = [];
  if (!primary) problems.push("no primary colour");
  if (fonts.length < 1) problems.push("no fonts");
  if (!hasLogo && !allowMinimal) problems.push("no logo or icon");
  if (!counts.shot) problems.push("no screenshots");
  const logoDesc = brand.logo.primary ? `${brand.logo.primary.kind} logo ${brand.logo.primary.width}×${brand.logo.primary.height}` : `${brand.logo.icons.length} icons only`;
  const summary = `${brand.name}: primary ${primary?.hex ?? "-"} (${primary?.reason ?? ""}); fonts ${fonts.map((f) => f.family).join(", ")}; ${logoDesc}; ${brand.imagery.length} images; ${(brand.durationMs / 1000).toFixed(1)}s [${tally}]`;
  return { target, ok: problems.length === 0, summary: problems.length ? `${problems.join(", ")} — ${summary}` : summary };
}

async function main() {
  if (!targets.length) {
    console.error("usage: pnpm smoke <url> [url...] [--allow-error]");
    process.exit(2);
  }
  const results: Outcome[] = [];
  for (const t of targets) {
    console.log(`\n▶ ${t}`);
    try {
      results.push(await scan(t));
    } catch (e) {
      results.push({ target: t, ok: false, summary: `request failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  console.log("\nResults");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.target}  ${r.summary}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

void main();
