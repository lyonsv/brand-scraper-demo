// Minimal font proxy so extracted web fonts can be previewed even when the origin
// does not send CORS headers. Only font files from public hosts are relayed.
import { assertPublicUrl } from "@/lib/url";


const MAX_BYTES = 3 * 1024 * 1024;
const FONT_EXT = /\.(woff2?|ttf|otf)(\?|#|$)/i;
const TYPES: Record<string, string> = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" };

export async function GET(req: Request): Promise<Response> {
  const target = new URL(req.url).searchParams.get("url") ?? "";
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (!FONT_EXT.test(url.pathname) && !url.hostname.endsWith("fonts.gstatic.com")) {
    return new Response("not a font", { status: 400 });
  }
  try {
    await assertPublicUrl(url);
  } catch {
    return new Response("blocked", { status: 403 });
  }
  const upstream = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!upstream || !upstream.ok || !upstream.body) return new Response("upstream failed", { status: 502 });
  const len = Number(upstream.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) return new Response("too large", { status: 413 });
  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return new Response("too large", { status: 413 });
  const ext = url.pathname.match(/\.(woff2?|ttf|otf)/i)?.[1]?.toLowerCase() ?? "woff2";
  return new Response(buf, {
    headers: {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
