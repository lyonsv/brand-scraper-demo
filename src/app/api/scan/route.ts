import { clientIp, limits, rateLimitEnabled } from "@/lib/ratelimit";
import { runScan } from "@/lib/scan/pipeline";
import type { ScanEvent } from "@/lib/types";

// Node.js runtime (Chromium can't run on the edge); 120s leaves headroom over the 90s scan budget.
export const runtime = "nodejs";
export const maxDuration = 120;

const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

const SCAN_TIMEOUT_MS = 90_000;

export async function POST(req: Request): Promise<Response> {
  if (rateLimitEnabled()) {
    const rl = limits.scan.check(clientIp(req.headers));
    if (!rl.ok) {
      const event: ScanEvent = {
        type: "error",
        code: "rate_limited",
        message: `Scan limit reached (${limits.scan.limit} per 10 minutes). Try again in ${Math.ceil(rl.retryAfter / 60)} min.`,
      };
      return new Response(`${JSON.stringify(event)}\n`, { status: 429, headers: { ...NDJSON_HEADERS, "Retry-After": String(rl.retryAfter) } });
    }
  }
  let url = "";
  try {
    const body = (await req.json()) as { url?: unknown };
    url = typeof body.url === "string" ? body.url : "";
  } catch {
    url = "";
  }

  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(SCAN_TIMEOUT_MS)]);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: ScanEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        await runScan(url, emit, signal);
      } finally {
        if (open) {
          open = false;
          try {
            controller.close();
          } catch {
            /* already closed by a disconnect */
          }
        }
      }
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}
