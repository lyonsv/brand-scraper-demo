import { describe, expect, it } from "vitest";
import { brandMarkColors, dominantChromatic, rasterTone, svgPaintColors, toneOf } from "@/lib/analyze";
import { clusterColors, parseColor, readableOn } from "@/lib/analyze/color";
import { contrastRatio } from "@/lib/analyze/contrast";
import { assignRoles, toWeightedHex } from "@/lib/analyze/roles";
import { isNavigational } from "@/lib/analyze/voice";
import { demoTokens, mixHex } from "@/lib/demo/generate";
import type { BrandGuide, ColorRole, RawExtraction } from "@/lib/types";

function role(r: string, hex: string): ColorRole {
  const p = parseColor(hex)!;
  return {
    role: r as ColorRole["role"],
    hex: p.hex,
    oklch: p.oklch,
    reason: "",
    derived: false,
    onWhite: { ratio: 1, rating: "Fail" },
    onBlack: { ratio: 1, rating: "Fail" },
    onColor: "#111111",
  };
}

function guide(roles: ColorRole[]): BrandGuide {
  return {
    url: "",
    finalUrl: "",
    domain: "x.test",
    name: "X",
    scannedAt: "2026-01-01T00:00:00Z",
    durationMs: 0,
    logo: { primary: null, alternates: [], icons: [] },
    colors: { roles, all: [], pairs: [], samplePoints: 0 },
    typography: { families: [], headingFamily: "Inter", bodyFamily: "Inter", scale: [], ratio: null, baseSize: 16 },
    ui: { primaryButton: null, secondaryButton: null, link: null, radius: [], spacing: [], shadows: [] },
    imagery: [],
    voice: { title: "", description: "", headline: "", headings: [], ctas: [], keywords: [], traits: [], stats: { avgHeadlineWords: 0, caseStyle: "mixed", exclamationRate: 0, youRate: 0 } },
  };
}

describe("readableOn", () => {
  it("keeps colours that already pass", () => {
    expect(readableOn("#635BFF", "#FFFFFF")).toBe("#635BFF");
  });
  it("darkens a light brand colour on white until it reaches 3:1, keeping the hue", () => {
    const out = readableOn("#FFE01B", "#FFFFFF");
    expect(contrastRatio(out, "#FFFFFF")).toBeGreaterThanOrEqual(3);
    expect(Math.abs(parseColor(out)!.oklch.h - parseColor("#FFE01B")!.oklch.h)).toBeLessThan(25);
  });
  it("lightens a dark colour on a dark background", () => {
    const out = readableOn("#000000", "#121212", 3, ["#FFFFFF"]);
    expect(contrastRatio(out, "#121212")).toBeGreaterThanOrEqual(3);
  });
});

describe("demo tokens are contrast-safe", () => {
  it("Mailchimp-like: yellow primary on white gets a readable eyebrow and badge", () => {
    const t = demoTokens(guide([role("primary", "#FFE01B"), role("background", "#FFFFFF"), role("text", "#241C15"), role("surface", "#F6F6F4")]));
    expect(contrastRatio(t.primaryText, t.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(t.badgeText, t.badgeBg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(t.onPrimary, t.primary)).toBeGreaterThanOrEqual(4.5);
  });
  it("Spotify-like: dark page with a green primary", () => {
    const t = demoTokens(guide([role("primary", "#1ED760"), role("background", "#121212"), role("text", "#FFFFFF")]));
    expect(t.primaryText).toBe("#1ED760");
    expect(contrastRatio(t.badgeText, t.badgeBg)).toBeGreaterThanOrEqual(3);
  });
  it("mixHex blends channels", () => {
    expect(mixHex("#FFFFFF", "#000000", 0.5)).toBe("#808080");
  });
});

describe("primary selection guards", () => {
  const dark = {
    backgrounds: toWeightedHex({ "#121212": 900, "#000000": 100 }),
    texts: toWeightedHex({ "#ffffff": 500, "#000000": 50, "#b3b3b3": 200 }),
    borders: [],
    cssVars: {},
  };
  it("never returns a primary with < 1.5:1 contrast against the background", () => {
    const { roles } = assignRoles({ ...dark, clusters: [], ctas: [{ bg: "#000000", label: "Home" }] });
    const p = roles.find((r) => r.role === "primary")!;
    expect(contrastRatio(p.hex, "#121212")).toBeGreaterThanOrEqual(1.5);
  });
  it("still accepts a vivid filled CTA that is hue-distinct from a light canvas (yellow on white)", () => {
    const { roles } = assignRoles({
      clusters: [],
      ctas: [{ bg: "#FFE01B", label: "Start Free Trial" }],
      cssVars: {},
      backgrounds: toWeightedHex({ "#ffffff": 900 }),
      texts: toWeightedHex({ "#241c15": 500 }),
      borders: [],
    });
    expect(roles.find((r) => r.role === "primary")?.hex).toBe("#FFE01B");
  });
  it("falls back to the brand mark colour (logo, then icon) before neutral fallbacks", () => {
    const { roles } = assignRoles({ ...dark, clusters: [], ctas: [], marks: [{ hex: "#1ED760", source: "icon" }] });
    const p = roles.find((r) => r.role === "primary")!;
    expect(p.hex).toBe("#1ED760");
    expect(p.reason).toMatch(/icon/);
  });
  it("muted is a neutral, never a brand role colour", () => {
    const clusters = clusterColors([
      { color: "#FFFFFF", weight: 900, source: "background" },
      { color: "#FFE01B", weight: 50, source: "cta" },
      { color: "#004E56", weight: 40, source: "background" },
    ]);
    const { roles } = assignRoles({
      clusters,
      ctas: [{ bg: "#FFE01B", label: "Start free trial" }],
      cssVars: {},
      backgrounds: toWeightedHex({ "#ffffff": 900, "#004e56": 40 }),
      texts: toWeightedHex({ "#241c15": 500, "#004e56": 200, "#6e6e6e": 50 }),
      borders: [],
    });
    const muted = roles.find((r) => r.role === "muted")!;
    expect(muted.hex).not.toBe("#004E56");
    expect(muted.oklch.c).toBeLessThan(0.06);
  });
});

describe("brand mark colours", () => {
  it("reads chromatic fills from the logo SVG", () => {
    const svg = '<svg><path fill="#1ED760"/><path fill="#000"/></svg>';
    expect(svgPaintColors(svg)["#1ED760"]).toBe(1);
    const raw = { logos: [{ kind: "svg", svg, alt: "", width: 1, height: 1, score: 1, reasons: [] }] } as unknown as RawExtraction;
    expect(brandMarkColors(raw, {})[0]).toEqual({ hex: "#1ED760", source: "logo" });
  });
  it("uses sampled icon pixels when the logo is monochrome", () => {
    const raw = { logos: [{ kind: "svg", svg: '<svg><path fill="#fff"/></svg>', alt: "", width: 1, height: 1, score: 1, reasons: [] }] } as unknown as RawExtraction;
    const marks = brandMarkColors(raw, { icon: { "rgb(24, 216, 96)": 600, "rgb(0, 0, 0)": 400 } });
    expect(marks).toHaveLength(1);
    expect(marks[0].source).toBe("icon");
  });
  it("classifies raster tones and finds the dominant chromatic pixel colour", () => {
    expect(toneOf({ "rgb(0, 30, 60)": 90, "rgb(255,255,255)": 5 })).toBe("dark");
    expect(toneOf({ "rgb(250, 250, 250)": 100 })).toBe("light");
    // no marker: a dominant white backdrop is still ignored
    expect(rasterTone({ "rgb(248, 248, 248)": 1374, "rgb(8, 0, 48)": 450, "rgb(64, 48, 88)": 40 })).toBe("dark");
    // white header behind a navy logo is ignored via the corner marker
    expect(toneOf({ "rgb(248, 248, 248)": 300, "rgb(16, 16, 64)": 80, "__bg__rgb(248, 248, 248)": 0 })).toBe("dark");
    expect(dominantChromatic({ "rgb(0,0,0)": 100, "rgb(255,224,27)": 40 })).toBe("#FFE01B");
    expect(dominantChromatic({ "rgb(0,0,0)": 100 })).toBeNull();
  });
});

describe("voice", () => {
  it("flags navigation labels", () => {
    expect(isNavigational("Your Library")).toBe(true);
    expect(isNavigational("Home")).toBe(true);
    expect(isNavigational("Financial infrastructure to grow your revenue")).toBe(false);
  });
});

describe("raster tone from a transparent logo file", () => {
  it("keeps every pixel when the sample is marked as having no backdrop", () => {
    expect(rasterTone({ "rgb(8, 0, 48)": 600, "rgb(248, 248, 248)": 200, __bg__none: 0 })).toBe("dark");
  });
});
