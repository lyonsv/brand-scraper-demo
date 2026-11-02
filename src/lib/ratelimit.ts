// In-memory sliding-window rate limiter, per server instance. On Vercel each warm instance keeps
// its own counters; that's a speed bump against casual abuse, not a global quota.

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** seconds until the oldest hit in the window expires */
  retryAfter: number;
}

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): RateLimitResult {
    const t = this.now();
    const fresh = (this.hits.get(key) ?? []).filter((ts) => t - ts < this.windowMs);
    if (fresh.length >= this.limit) {
      this.hits.set(key, fresh);
      return { ok: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((fresh[0] + this.windowMs - t) / 1000)) };
    }
    fresh.push(t);
    this.hits.set(key, fresh);
    if (this.hits.size > 10_000) this.sweep(t);
    return { ok: true, remaining: this.limit - fresh.length, retryAfter: 0 };
  }

  private sweep(t: number) {
    for (const [k, v] of this.hits) if (!v.some((ts) => t - ts < this.windowMs)) this.hits.delete(k);
  }
}

/** Client IP as seen by Vercel's edge (x-real-ip), else the first x-forwarded-for hop. */
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || "local";
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const g = globalThis as typeof globalThis & { __brandScraperLimits?: { scan: RateLimiter; font: RateLimiter } };
export const limits = (g.__brandScraperLimits ??= {
  scan: new RateLimiter(envInt("BS_SCAN_LIMIT", 5), 10 * 60_000),
  font: new RateLimiter(envInt("BS_FONT_LIMIT", 240), 10 * 60_000),
});

/** Always on for the public Vercel deploy; opt-in locally with BS_RATE_LIMIT=1. */
export function rateLimitEnabled(): boolean {
  return !!process.env.VERCEL || process.env.BS_RATE_LIMIT === "1";
}
