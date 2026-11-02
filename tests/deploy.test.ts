import { describe, expect, it } from "vitest";
import { clientIp, RateLimiter } from "@/lib/ratelimit";
import { acquireSlot, serverlessArgs, UNSAFE_SERVERLESS_FLAGS } from "@/lib/scan/browser";
import { fontUrls } from "@/lib/scan/fonts-serverless";
import { ScanError } from "@/lib/errors";

describe("RateLimiter", () => {
  it("allows `limit` hits per window, then reports retry-after, then recovers", () => {
    let now = 0;
    const rl = new RateLimiter(5, 600_000, () => now);
    for (let i = 0; i < 5; i++) expect(rl.check("1.2.3.4").ok).toBe(true);
    const blocked = rl.check("1.2.3.4");
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBe(600);
    expect(rl.check("5.6.7.8").ok).toBe(true); // per key
    now = 600_001;
    expect(rl.check("1.2.3.4").ok).toBe(true);
  });
  it("reads the client IP from x-real-ip, then x-forwarded-for", () => {
    expect(clientIp(new Headers({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }))).toBe("9.9.9.9");
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 10.0.0.1" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers())).toBe("local");
  });
});

describe("serverless Chromium args", () => {
  it("drops flags that would weaken browser security, keeps the rest", () => {
    const base = ["--single-process", "--disable-web-security", "--allow-running-insecure-content", "--disable-site-isolation-trials", "--no-sandbox", "--headless='shell'"];
    const out = serverlessArgs(base);
    for (const f of UNSAFE_SERVERLESS_FLAGS) expect(out).not.toContain(f);
    // --single-process is dropped: closing a context killed the shared browser (next scan failed).
    // --disable-3d-apis is added: SwiftShader WebGL starved the renderer (stripe.com screenshots timed out).
    expect(out).toEqual(["--no-sandbox", "--headless='shell'", "--disable-3d-apis"]);
    // the egress proxy is applied per context by Playwright, never via a launch flag
    expect(out.some((a) => a.startsWith("--proxy-server"))).toBe(false);
  });
  it("only downloads https fallback fonts and can be disabled", () => {
    expect(fontUrls({} as unknown as NodeJS.ProcessEnv).length).toBeGreaterThan(0);
    expect(fontUrls({ BS_FONT_URLS: "" } as unknown as NodeJS.ProcessEnv)).toEqual([]);
    expect(fontUrls({ BS_FONT_URLS: "http://x/a.ttf, https://y/b.ttf" } as unknown as NodeJS.ProcessEnv)).toEqual(["https://y/b.ttf"]);
  });
});

describe("concurrency limit", () => {
  it("fails fast with `busy` instead of queueing forever", async () => {
    const ctrl = new AbortController();
    const a = await acquireSlot(ctrl.signal, 50);
    const b = await acquireSlot(ctrl.signal, 50);
    const started = Date.now();
    await expect(acquireSlot(ctrl.signal, 50)).rejects.toSatisfy((e: unknown) => e instanceof ScanError && e.code === "busy");
    expect(Date.now() - started).toBeLessThan(1000);
    a.release();
    const c = await acquireSlot(ctrl.signal, 50);
    b.release();
    c.release();
  });
});
