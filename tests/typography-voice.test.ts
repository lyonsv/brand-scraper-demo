import { describe, expect, it } from "vitest";
import { buildTypeScale, buildTypography, parseFontFaces, prettyFamily, scaleRatio } from "@/lib/analyze/typography";
import { analyzeVoice, classifyCase, dominantCase, topKeywords } from "@/lib/analyze/voice";
import { cleanShadow, normaliseRadius, svgTone } from "@/lib/analyze";
import { buildDemoHtml, escapeHtml, safeUrl } from "@/lib/demo/generate";
import type { RawTypeSample } from "@/lib/types";

const sample = (tag: string, fontSize: number, count = 10, fontFamily = "Inter, sans-serif"): RawTypeSample => ({
  tag,
  fontSize,
  fontWeight: "400",
  lineHeight: "normal",
  letterSpacing: "normal",
  fontFamily,
  color: "rgb(0,0,0)",
  text: `${tag} sample`,
  count,
});

describe("type scale", () => {
  it("keeps the most common style per tag in h1→small order", () => {
    const scale = buildTypeScale([sample("p", 16, 100), sample("p", 14, 5), sample("h2", 32), sample("h1", 48), sample("small", 12)]);
    expect(scale.map((s) => s.tag)).toEqual(["h1", "h2", "p", "small"]);
    expect(scale.find((s) => s.tag === "p")?.fontSize).toBe(16);
  });
  it("estimates a modular ratio", () => {
    const scale = buildTypeScale([sample("h1", 64), sample("h2", 40), sample("h3", 25), sample("p", 16)]);
    expect(scaleRatio(scale)).toBeCloseTo(1.59, 2);
    expect(scaleRatio(buildTypeScale([sample("p", 16)]))).toBeNull();
  });
  it("parses @font-face and resolves URLs relative to the sheet", () => {
    const faces = parseFontFaces(
      `@font-face{font-family:"Sohne";src:url(../fonts/sohne.woff2) format("woff2"),url(/f/sohne.woff) format("woff");font-weight:400 700}`,
      "https://cdn.example.com/css/site.css",
    );
    expect(faces[0].family).toBe("Sohne");
    expect(faces[0].sources[0]).toEqual({ url: "https://cdn.example.com/fonts/sohne.woff2", format: "woff2" });
    expect(faces[0].weight).toBe("400 700");
  });
  it("un-hashes next/font family names and assigns heading/body roles", () => {
    expect(prettyFamily("__Inter_d65c78")).toBe("Inter");
    const t = buildTypography({
      families: { "Inter, sans-serif": 900, "Georgia, serif": 100 },
      headingFamilies: { "Georgia, serif": 100 },
      fontFaces: [{ family: "Inter", weight: "400", style: "normal" }],
      typeSamples: [sample("p", 16), sample("h1", 48, 10, "Georgia, serif")],
      parsedFaces: [],
    });
    expect(t.bodyFamily).toBe("Inter");
    expect(t.headingFamily).toBe("Georgia");
    expect(t.families.find((f) => f.family === "Georgia")?.role).toBe("heading");
    expect(t.families.find((f) => f.family === "Inter")?.usage).toBeCloseTo(0.9, 2);
  });
});

describe("voice heuristics", () => {
  it("classifies casing", () => {
    expect(classifyCase("Financial infrastructure to grow your revenue")).toBe("sentence");
    expect(classifyCase("Financial Infrastructure To Grow Your Revenue")).toBe("title");
    expect(classifyCase("BUILD SOMETHING GREAT")).toBe("upper");
    expect(dominantCase(["Plan the work", "Ship faster today", "The Product Team Loves"])).toBe("sentence");
  });
  it("computes rates, keywords and traits", () => {
    const v = analyzeVoice({
      title: "Acme",
      description: "Payments for your business. You will love it!",
      h1: ["Payments made simple"],
      headings: ["Grow your revenue", "Payments in 135 currencies", "Trusted by 1,000,000 businesses"],
      ctas: ["Get started", "Contact sales"],
      paragraphs: ["Accept payments online. Your customers pay in seconds. Payments are secure."],
    });
    expect(v.stats.caseStyle).toBe("sentence");
    expect(v.stats.youRate).toBeGreaterThan(1.5);
    expect(v.stats.exclamationRate).toBeGreaterThan(0);
    expect(v.keywords[0]).toBe("payments");
    expect(v.traits).toContain("Action-led CTAs");
    expect(v.traits).toContain("Leads with numbers & proof");
    expect(v.headline).toBe("Payments made simple");
  });
  it("ignores stopwords in keywords", () => {
    expect(topKeywords(["the the the and with your your"])).toEqual([]);
  });
});

describe("ui helpers & demo page", () => {
  it("normalises radii and strips invisible shadows", () => {
    expect(normaliseRadius("3.35544e+07px")).toBe("9999px");
    expect(normaliseRadius("50%")).toBe("9999px");
    expect(normaliseRadius("6px")).toBe("6px");
    expect(cleanShadow("rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(235, 235, 235) 0px 0px 0px 1px")).toBe("rgb(235, 235, 235) 0px 0px 0px 1px");
    expect(cleanShadow("rgba(0, 0, 0, 0) 0px 0px 0px 0px")).toBe("");
  });
  it("detects single-tone logos", () => {
    expect(svgTone('<svg><path fill="rgb(10, 37, 64)"/></svg>')).toBe("dark");
    expect(svgTone('<svg><path fill="#fff"/></svg>')).toBe("light");
    expect(svgTone('<svg><path fill="#635BFF"/></svg>')).toBe("color");
  });
  it("escapes text and rejects unsafe URLs", () => {
    expect(escapeHtml(`<img onerror="x">`)).toBe("&lt;img onerror=&quot;x&quot;&gt;");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("https://a.com/x.png")).toBe("https://a.com/x.png");
  });
  it("builds an escaped, contrast-aware demo page from tokens", () => {
    const role = (r: string, hex: string) => ({
      role: r,
      hex,
      oklch: { l: 0.5, c: 0.2, h: 270 },
      reason: "",
      derived: false,
      onWhite: { ratio: 1, rating: "Fail" as const },
      onBlack: { ratio: 1, rating: "Fail" as const },
      onColor: "#FFFFFF",
    });
    const html = buildDemoHtml({
      url: "https://acme.test/",
      finalUrl: "https://acme.test/",
      domain: "acme.test",
      name: "Acme <b>",
      scannedAt: "2026-01-01T00:00:00Z",
      durationMs: 1,
      logo: { primary: null, alternates: [], icons: [] },
      colors: {
        roles: [role("primary", "#635BFF"), role("background", "#FFFFFF"), role("text", "#0A2540")] as never,
        all: [],
        pairs: [],
        samplePoints: 0,
      },
      typography: { families: [], headingFamily: "Inter", bodyFamily: "Inter", scale: [], ratio: null, baseSize: 16 },
      ui: { primaryButton: null, secondaryButton: null, link: null, radius: [], spacing: [], shadows: [] },
      imagery: [{ src: "javascript:alert(1)", alt: "", width: 1, height: 1 }],
      voice: {
        title: "Acme",
        description: "",
        headline: "<script>alert(1)</script>",
        headings: [],
        ctas: [],
        keywords: [],
        traits: [],
        stats: { avgHeadlineWords: 0, caseStyle: "mixed", exclamationRate: 0, youRate: 0 },
      },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("Acme &lt;b&gt;");
    expect(html).toMatch(/\.btn-primary\{background:#635BFF;color:#FFFFFF\}/);
  });
});
