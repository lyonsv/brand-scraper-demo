import http from "node:http";
import { connect } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeColors, variableColors } from "@/lib/analyze";
import { clusterColors, parseColor } from "@/lib/analyze/color";
import { assignRoles, toWeightedHex } from "@/lib/analyze/roles";
import { fetchPublic, getEgressProxyPort, sniffFont } from "@/lib/scan/egress";
import { formatWeight } from "@/lib/fonts";
import type { RawExtraction } from "@/lib/types";

describe("parseColor robustness", () => {
  it.each(["calc(1px + 2px)", "rgb(calc(1) 2 3)", "var(--x)", "rgb(0 0 0 / var(--a))", "env(safe-area-inset-top)", "clamp(1rem, 2vw, 3rem)", "", "inherit"])(
    "returns null instead of throwing for %s",
    (v) => expect(parseColor(v)).toBeNull(),
  );
  it("does not read bare numbers or hex without # as colours", () => {
    expect(parseColor("300")).toBeNull();
    expect(parseColor("fff")).toBeNull();
    expect(parseColor("1px solid red")).toBeNull();
    expect(parseColor("#fff")?.hex).toBe("#FFFFFF");
    expect(parseColor("rebeccapurple")?.hex).toBe("#663399");
  });
  it("survives a CSS variable dump full of non-colours", () => {
    const vars = { "--a": "calc(100% - 2px)", "--b": "#635BFF", "--c": "var(--b)", "--d": "1px solid red", "--e": "rgb(calc(1) 2 3)" };
    expect(Object.keys(variableColors(vars))).toEqual(["#635BFF"]);
    const raw = {
      bgColors: { "rgb(255, 255, 255)": 100 },
      textColors: { "rgb(0, 0, 0)": 100 },
      borderColors: {},
      buttons: [],
      cssVars: vars,
    } as unknown as RawExtraction;
    expect(() => analyzeColors(raw, 100)).not.toThrow();
  });
});

describe("primary never equals the page background", () => {
  const base = {
    backgrounds: toWeightedHex({ "#ffffff": 900, "#008060": 30 }),
    texts: toWeightedHex({ "#111111": 500 }),
    borders: [],
    cssVars: {},
  };
  it("skips a white CTA on a white page and takes the green one", () => {
    const clusters = clusterColors([
      { color: "#FFFFFF", weight: 900, source: "background" },
      { color: "#008060", weight: 30, source: "cta" },
    ]);
    const { roles } = assignRoles({ ...base, clusters, ctas: [{ bg: "#ffffff", label: "Skip" }, { bg: "#008060", label: "Start free trial" }] });
    expect(roles.find((r) => r.role === "primary")?.hex).toBe("#008060");
  });
  it("prefers the CTA colour used on several buttons", () => {
    const { roles } = assignRoles({
      ...base,
      clusters: [],
      ctas: [
        { bg: "#E11D48", label: "Promo" },
        { bg: "#2563EB", label: "Start" },
        { bg: "#2563EB", label: "Try it" },
        { bg: "#2563EB", label: "Buy" },
      ],
    });
    expect(roles.find((r) => r.role === "primary")?.hex).toBe("#2563EB");
  });
  it("prefers a design-system (CSS variable) hue over a stray illustration colour", () => {
    const clusters = clusterColors([
      { color: "#FFFFFF", weight: 900, source: "background" },
      { color: "#F7BF8B", weight: 7, source: "text" },
      { color: "#5E6AD2", weight: 3, source: "variable" },
      { color: "#5E6AD2", weight: 1, source: "text" },
    ]);
    const { roles } = assignRoles({ ...base, clusters, ctas: [], cssVars: { "--color-indigo": "#5e6ad2" } });
    expect(roles.find((r) => r.role === "primary")?.hex).toBe("#5E6AD2");
  });
  it("never picks a neutral CTA that matches the background", () => {
    const { roles } = assignRoles({ ...base, clusters: [], ctas: [{ bg: "#FEFEFE", label: "Skip to content" }] });
    expect(roles.find((r) => r.role === "primary")?.hex).not.toBe("#FEFEFE");
  });
});

describe("font helpers", () => {
  it("sniffs font magic bytes", () => {
    expect(sniffFont(Buffer.from("wOF2xxxx"))).toBe("woff2");
    expect(sniffFont(Buffer.from("wOFFxxxx"))).toBe("woff");
    expect(sniffFont(Buffer.from("OTTOxxxx"))).toBe("otf");
    expect(sniffFont(Buffer.from([0, 1, 0, 0, 9]))).toBe("ttf");
    expect(sniffFont(Buffer.from("<html>"))).toBeNull();
  });
  it("formats variable weight ranges", () => {
    expect(formatWeight("1 1000")).toBe("1–1000 (variable)");
    expect(formatWeight("400")).toBe("400");
  });
});

describe("egress: connect-time private-address blocking", () => {
  let server: http.Server;
  let hits = 0;
  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      hits++;
      res.end("SECRET");
    });
    await new Promise<void>((r) => server.listen(3299, "127.0.0.1", () => r()));
  });
  afterAll(() => server.close());

  it("fetchPublic refuses loopback literals and hostnames", async () => {
    await expect(fetchPublic(new URL("http://127.0.0.1:3299/"), { maxBytes: 1000, timeoutMs: 2000 })).rejects.toThrow(/not public/);
    await expect(fetchPublic(new URL("http://localhost:3299/"), { maxBytes: 1000, timeoutMs: 2000 })).rejects.toThrow(/non-public/);
    expect(hits).toBe(0);
  });

  it("the forward proxy refuses CONNECT and plain requests to private addresses", async () => {
    const port = await getEgressProxyPort();
    const connectStatus = await new Promise<string>((resolve) => {
      const sock = connect(port, "127.0.0.1", () => sock.write("CONNECT localhost:3299 HTTP/1.1\r\nHost: localhost:3299\r\n\r\n"));
      sock.once("data", (d) => {
        resolve(d.toString().split("\r\n")[0]);
        sock.destroy();
      });
    });
    expect(connectStatus).toMatch(/403/);
    const plain = await new Promise<number>((resolve) => {
      http.get({ host: "127.0.0.1", port, path: "http://127.0.0.1:3299/secret", headers: { host: "127.0.0.1:3299" } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
    });
    expect(plain).toBe(403);
    expect(hits).toBe(0);
  });
});
