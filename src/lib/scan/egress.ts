// A tiny local forward proxy that Chromium is forced through. It resolves every destination
// itself and refuses non-public addresses at connect time, which covers redirects, iframes,
// subresources, websockets and DNS rebinding (the vetted address is the one we connect to).
import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, connect, type LookupFunction, type Socket } from "node:net";
import { isBlockedIp } from "../url";

export class BlockedAddressError extends Error {
  readonly code = "EBLOCKED";
}

/** Drop-in `lookup` for net/http/https that rejects private, loopback, link-local and metadata IPs. */
export const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, family: options.family }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = (addresses as Array<{ address: string; family: number }>) ?? [];
    const bad = list.find((a) => isBlockedIp(a.address));
    if (bad || list.length === 0) {
      return callback(new BlockedAddressError(`${hostname} resolves to a non-public address`) as NodeJS.ErrnoException, "", 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

/** True if this literal host is an IP we refuse to reach. Hostnames are checked by safeLookup. */
function literalBlocked(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  return isIP(h) !== 0 && isBlockedIp(h);
}

interface EgressState {
  port: Promise<number> | null;
  blocked: number;
}

const g = globalThis as typeof globalThis & { __brandScraperEgress?: EgressState };
const state: EgressState = (g.__brandScraperEgress ??= { port: null, blocked: 0 });

function refuse(socket: Socket) {
  state.blocked++;
  socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
}

function createProxy(): http.Server {
  const server = http.createServer((req, res) => {
    // plain-HTTP forward request: req.url is absolute
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== "http:" || literalBlocked(target.hostname)) {
      state.blocked++;
      res.writeHead(403).end();
      return;
    }
    const headers = { ...req.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    const upstream = http.request(
      {
        host: target.hostname.replace(/^\[|\]$/g, ""),
        port: target.port || 80,
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers,
        lookup: safeLookup,
        timeout: 30_000,
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", (e) => {
      if (e instanceof BlockedAddressError) state.blocked++;
      if (!res.headersSent) res.writeHead(e instanceof BlockedAddressError ? 403 : 502);
      res.end();
    });
    upstream.on("timeout", () => upstream.destroy());
    req.pipe(upstream);
  });

  server.on("connect", (req: http.IncomingMessage, client: Socket, head: Buffer) => {
    // HTTPS / WSS tunnel: "host:port"
    const m = (req.url ?? "").match(/^\[?([^\]]+?)\]?:(\d+)$/);
    if (!m || literalBlocked(m[1])) return refuse(client);
    const upstream = connect({ host: m[1], port: Number(m[2]), lookup: safeLookup, timeout: 30_000 });
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", (e) => {
      if (e instanceof BlockedAddressError) return refuse(client);
      client.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    });
    client.on("error", () => upstream.destroy());
  });
  server.on("clientError", (_e, socket) => socket.destroy());
  return server;
}

/** Start (once per process) and return the proxy's port on 127.0.0.1. */
export function getEgressProxyPort(): Promise<number> {
  if (!state.port) {
    state.port = new Promise<number>((resolve, reject) => {
      const server = createProxy();
      server.once("error", (e) => {
        state.port = null;
        reject(e);
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        server.unref();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });
  }
  return state.port;
}

export function egressBlockedCount(): number {
  return state.blocked;
}

export interface PublicFetchResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/**
 * GET a URL from Node with the same connect-time IP check as the proxy (DNS is resolved and
 * vetted by safeLookup, then that exact address is used). No redirects are followed.
 */
export function fetchPublic(url: URL, opts: { signal?: AbortSignal; maxBytes: number; timeoutMs: number }): Promise<PublicFetchResult> {
  return new Promise((resolve, reject) => {
    if (literalBlocked(url.hostname)) return reject(new BlockedAddressError(`${url.hostname} is not public`));
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.get(
      url,
      { lookup: safeLookup, timeout: opts.timeoutMs, signal: opts.signal, headers: { "user-agent": "brand-scraper-demo font proxy" } },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > opts.maxBytes) {
            req.destroy(new Error("too large"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

/** Detect a font container from its magic bytes. */
export function sniffFont(buf: Buffer): "woff2" | "woff" | "ttf" | "otf" | null {
  if (buf.length < 4) return null;
  const sig = buf.subarray(0, 4).toString("latin1");
  if (sig === "wOF2") return "woff2";
  if (sig === "wOFF") return "woff";
  if (sig === "OTTO") return "otf";
  if (sig === "true" || buf.readUInt32BE(0) === 0x00010000) return "ttf";
  return null;
}
