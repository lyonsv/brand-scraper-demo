import { describe, expect, it } from "vitest";
import { ScanError } from "@/lib/errors";
import { assertPublicUrl, createHostGuard, isBlockedIp, normalizeUrl } from "@/lib/url";

const resolveTo = (...ips: string[]) => async () => ips;

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ScanError ? e.code : "other";
  }
}

describe("normalizeUrl", () => {
  it("adds https to bare domains", () => {
    expect(normalizeUrl("stripe.com").href).toBe("https://stripe.com/");
    expect(normalizeUrl("  linear.app/path#frag ").href).toBe("https://linear.app/path");
  });
  it("rejects non-http schemes and junk", () => {
    for (const bad of ["", "ftp://x.com", "file:///etc/passwd", "javascript:alert(1)", "not a url", "intranet"]) {
      expect(() => normalizeUrl(bad)).toThrow(ScanError);
    }
  });
  it("rejects credentials in URLs", () => {
    expect(() => normalizeUrl("https://user:pw@example.com")).toThrow(/credentials/);
  });
});

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd00:ec2::254",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::a9fe:a9fe",
  ])("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true));
  it.each(["8.8.8.8", "172.32.0.1", "52.215.231.162", "2606:4700:10::6814:179a", "2a06:98c1:3105::6812:282d"])("allows %s", (ip) =>
    expect(isBlockedIp(ip)).toBe(false),
  );
});

describe("assertPublicUrl", () => {
  it("blocks loopback, metadata and private literals", async () => {
    expect(await codeOf(assertPublicUrl(new URL("http://127.0.0.1:3000")))).toBe("blocked_url");
    expect(await codeOf(assertPublicUrl(new URL("http://169.254.169.254/latest/meta-data")))).toBe("blocked_url");
    expect(await codeOf(assertPublicUrl(new URL("http://[::1]/")))).toBe("blocked_url");
    expect(await codeOf(assertPublicUrl(new URL("http://localhost/")))).toBe("blocked_url");
    expect(await codeOf(assertPublicUrl(new URL("http://metadata.google.internal/")))).toBe("blocked_url");
  });
  it("blocks hostnames that resolve to private addresses (DNS rebinding style)", async () => {
    expect(await codeOf(assertPublicUrl(new URL("https://evil.example"), resolveTo("93.184.216.34", "10.0.0.5")))).toBe("blocked_url");
  });
  it("allows public resolutions and reports DNS failures as nav_failed", async () => {
    expect(await codeOf(assertPublicUrl(new URL("https://stripe.com"), resolveTo("52.215.231.162")))).toBeNull();
    const failing = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await codeOf(assertPublicUrl(new URL("https://nope.invalid"), failing))).toBe("nav_failed");
  });
  it("host guard caches per host and rejects private redirects", async () => {
    let calls = 0;
    const guard = createHostGuard(async (h) => {
      calls++;
      return h === "internal.corp" ? ["192.168.0.10"] : ["8.8.8.8"];
    });
    expect(await guard("https://ok.com/a")).toBe(true);
    expect(await guard("https://ok.com/b")).toBe(true);
    expect(calls).toBe(1);
    expect(await guard("http://internal.corp/admin")).toBe(false);
    expect(await guard("file:///etc/passwd")).toBe(false);
    expect(await guard("data:image/png;base64,AAAA")).toBe(true);
  });
});
