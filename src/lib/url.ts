import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ScanError } from "./errors";

export type Resolver = (hostname: string) => Promise<string[]>;

const defaultResolver: Resolver = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};

const BLOCKED_HOSTNAMES = [/^localhost$/i, /\.localhost$/i, /\.internal$/i, /\.local$/i, /^metadata$/i];

/** Turn user input ("stripe.com", " https://x.y/path ") into a URL, or throw invalid_url. */
export function normalizeUrl(raw: string): URL {
  const input = (raw ?? "").trim();
  if (!input) throw new ScanError("invalid_url", "Please enter a URL.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ScanError("invalid_url", `"${input}" is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ScanError("invalid_url", "Only http and https URLs can be scanned.");
  }
  if (url.username || url.password) {
    throw new ScanError("invalid_url", "URLs with credentials are not allowed.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || (!host.includes(".") && !host.includes(":") && isIP(host) === 0)) {
    // bare words like "intranet" are not public websites
    if (!BLOCKED_HOSTNAMES.some((re) => re.test(host))) {
      throw new ScanError("invalid_url", `"${input}" is not a valid public hostname.`);
    }
  }
  url.hash = "";
  return url;
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inV4Range(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const V4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. 169.254.169.254 metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

/** Expand an IPv6 address into 8 16-bit groups. Returns null if unparsable. */
function expandIpv6(ip: string): number[] | null {
  let addr = ip.toLowerCase().split("%")[0];
  // embedded IPv4 tail (::ffff:1.2.3.4)
  const v4Tail = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Tail) {
    const n = ipv4ToInt(v4Tail[1]);
    addr = addr.slice(0, -v4Tail[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = addr.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail !== undefined && tail !== "" ? tail.split(":") : [];
  if (addr.includes("::")) {
    const missing = 8 - headParts.length - tailParts.length;
    if (missing < 0) return null;
    const groups = [...headParts, ...Array(missing).fill("0"), ...tailParts];
    return groups.map((g) => parseInt(g, 16));
  }
  if (headParts.length !== 8) return null;
  return headParts.map((g) => parseInt(g, 16));
}

/** True for private, loopback, link-local, metadata and other non-public addresses. */
export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return V4_BLOCKED.some(([base, bits]) => inV4Range(ip, base, bits));
  if (version === 6) {
    const g = expandIpv6(ip);
    if (!g || g.some((n) => Number.isNaN(n))) return true;
    if (g.every((n) => n === 0)) return true; // ::
    if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true; // ::1
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible / NAT64 (64:ff9b::/96)
    const mapped = g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff;
    const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0);
    if (mapped || nat64) {
      const v4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
      return isBlockedIp(v4);
    }
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (incl. fd00:ec2::254)
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g[0] & 0xff00) === 0xff00) return true; // multicast
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
    return false;
  }
  return true; // not an IP at all
}

/**
 * Resolve the URL's hostname and throw blocked_url if it (or any record) points at a
 * non-public address. Returns the resolved addresses.
 */
export async function assertPublicUrl(url: URL, resolver: Resolver = defaultResolver): Promise<string[]> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ScanError("blocked_url", `Protocol ${url.protocol} is not allowed.`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.some((re) => re.test(host))) {
    throw new ScanError("blocked_url", `${host} is an internal hostname.`);
  }
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await resolver(host);
    } catch {
      throw new ScanError("nav_failed", `Could not resolve ${host}. Check the domain name.`);
    }
    if (addresses.length === 0) throw new ScanError("nav_failed", `Could not resolve ${host}.`);
  }
  const bad = addresses.find(isBlockedIp);
  if (bad) throw new ScanError("blocked_url", `${host} resolves to a private address (${bad}).`);
  return addresses;
}

/** Cached boolean check, used for every request the page makes (redirects, subresources). */
export function createHostGuard(resolver: Resolver = defaultResolver) {
  const cache = new Map<string, Promise<boolean>>();
  return (url: string): Promise<boolean> => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return Promise.resolve(false);
    }
    if (parsed.protocol === "data:" || parsed.protocol === "blob:") return Promise.resolve(true);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return Promise.resolve(false);
    const key = `${parsed.protocol}//${parsed.hostname}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = assertPublicUrl(parsed, resolver).then(
        () => true,
        () => false,
      );
      cache.set(key, hit);
    }
    return hit;
  };
}
