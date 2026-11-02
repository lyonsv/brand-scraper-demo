import { runScan } from "@/lib/scan/pipeline";
import type { ScanEvent } from "@/lib/types";

export const maxDuration = 120;

const SCAN_TIMEOUT_MS = 90_000;

export async function POST(req: Request): Promise<Response> {
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

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
