// Minimal font proxy so extracted web fonts can be previewed even when the origin does not send
// CORS headers. Only public hosts (checked at connect time) and only real font files are relayed.
import { clientIp, limits, rateLimitEnabled } from "@/lib/ratelimit";
import { fetchPublic, sniffFont } from "@/lib/scan/egress";

export const runtime = "nodejs";

const MAX_BYTES = 3 * 1024 * 1024;
const TYPES = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" } as const;

export async function GET(req: Request): Promise<Response> {
  if (rateLimitEnabled()) {
    const rl = limits.font.check(clientIp(req.headers));
    if (!rl.ok) return new Response("rate limited", { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  }
  const target = new URL(req.url).searchParams.get("url") ?? "";
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return new Response("bad url", { status: 400 });
  let result;
  try {
    result = await fetchPublic(url, { signal: req.signal, maxBytes: MAX_BYTES, timeoutMs: 8000 });
  } catch (e) {
    const blocked = e instanceof Error && /not public|non-public/.test(e.message);
    return new Response(blocked ? "blocked" : "upstream failed", { status: blocked ? 403 : 502 });
  }
  if (result.status !== 200) return new Response("upstream failed", { status: 502 });
  const kind = sniffFont(result.body);
  if (!kind) return new Response("not a font", { status: 415 });
  return new Response(new Uint8Array(result.body), {
    headers: {
      "Content-Type": TYPES[kind],
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
