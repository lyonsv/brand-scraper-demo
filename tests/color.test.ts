import { describe, expect, it } from "vitest";
import { clusterColors, hueDistance, isNeutral, parseColor } from "@/lib/analyze/color";
import { contrast, contrastRatio, pickTextColor, rateContrast } from "@/lib/analyze/contrast";
import { assignRoles, toWeightedHex } from "@/lib/analyze/roles";

describe("parseColor", () => {
  it("parses rgb, oklch and display-p3 computed values", () => {
    expect(parseColor("rgb(99, 91, 255)")?.hex).toBe("#635BFF");
    expect(parseColor("oklch(0.6 0.2 270)")?.oklch.c).toBeCloseTo(0.2, 2);
    expect(parseColor("color(display-p3 1 0 0)")?.hex).toMatch(/^#[0-9A-F]{6}$/);
  });
  it("ignores transparent and junk", () => {
    expect(parseColor("rgba(0, 0, 0, 0)")).toBeNull();
    expect(parseColor("transparent")).toBeNull();
    expect(parseColor("banana")).toBeNull();
  });
  it("classifies neutrals by OKLCH chroma", () => {
    expect(isNeutral(parseColor("#777777")!.oklch)).toBe(true);
    expect(isNeutral(parseColor("#635BFF")!.oklch)).toBe(false);
  });
});

describe("clusterColors", () => {
  it("merges perceptually close colours and keeps the heaviest as representative", () => {
    const clusters = clusterColors([
      { color: "#635BFF", weight: 10, source: "cta" },
      { color: "#645CFF", weight: 2, source: "background" },
      { color: "#FFFFFF", weight: 50, source: "background" },
      { color: "#FF5B5B", weight: 5, source: "text" },
    ]);
    expect(clusters).toHaveLength(3);
    expect(clusters[0].hex).toBe("#FFFFFF");
    const purple = clusters.find((c) => c.hex === "#635BFF")!;
    expect(purple.members).toContain("#645CFF");
    expect(purple.weight).toBe(12);
    expect(purple.sources.cta).toBe(10);
    expect(clusters.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 5);
  });
  it("keeps distinct hues apart", () => {
    const clusters = clusterColors([
      { color: "#0000FF", weight: 1, source: "text" },
      { color: "#00AA00", weight: 1, source: "text" },
    ]);
    expect(clusters).toHaveLength(2);
  });
  it("hueDistance wraps around 360°", () => {
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(90, 270)).toBe(180);
  });
});

describe("contrast", () => {
  it("matches WCAG reference values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
    expect(rateContrast(7.1)).toBe("AAA");
    expect(rateContrast(4.5)).toBe("AA");
    expect(rateContrast(3.2)).toBe("AA Large");
    expect(contrast("#EEEEEE", "#FFFFFF").rating).toBe("Fail");
  });
  it("picks readable text colours", () => {
    expect(pickTextColor("#635BFF")).toBe("#FFFFFF");
    expect(pickTextColor("#FFD7EF")).toBe("#111111");
    expect(pickTextColor("#FFFFFF", ["#0A2540"])).toBe("#0A2540");
  });
});

describe("assignRoles", () => {
  const base = {
    backgrounds: toWeightedHex({ "rgb(255, 255, 255)": 900, "rgb(246, 249, 252)": 300, "rgb(99, 91, 255)": 20 }),
    texts: toWeightedHex({ "rgb(10, 37, 64)": 500, "rgb(66, 84, 102)": 200 }),
    borders: toWeightedHex({ "rgb(227, 232, 238)": 40 }),
    cssVars: {},
  };
  const clusters = clusterColors([
    { color: "#FFFFFF", weight: 900, source: "background" },
    { color: "#635BFF", weight: 60, source: "cta" },
    { color: "#00D4FF", weight: 30, source: "background" },
    { color: "#FF5996", weight: 15, source: "background" },
    { color: "#0A2540", weight: 500, source: "text" },
  ]);

  it("takes primary from the top chromatic CTA and finds distinct secondary/accent hues", () => {
    const { roles, pairs } = assignRoles({ ...base, clusters, ctas: [{ bg: "rgb(99, 91, 255)", label: "Start now" }] });
    const get = (r: string) => roles.find((x) => x.role === r);
    expect(get("primary")?.hex).toBe("#635BFF");
    expect(get("primary")?.reason).toMatch(/Start now/);
    expect(get("secondary")).toBeDefined();
    expect(hueDistance(get("secondary")!.oklch.h, get("primary")!.oklch.h)).toBeGreaterThanOrEqual(30);
    expect(get("background")?.hex).toBe("#FFFFFF");
    expect(get("surface")?.hex).toBe("#F6F9FC");
    expect(get("text")?.hex).toBe("#0A2540");
    expect(get("muted")?.hex).toBe("#425466");
    expect(get("border")?.hex).toBe("#E3E8EE");
    expect(pairs.find((p) => p.label === "Text on background")?.result.rating).toBe("AAA");
  });

  it("falls back to a brand CSS variable when CTAs are neutral", () => {
    const { roles } = assignRoles({ ...base, clusters, ctas: [{ bg: "rgb(255,255,255)", label: "Log in" }], cssVars: { "--brand-primary": "#5E6AD2", "--text-primary": "#111" } });
    expect(roles.find((r) => r.role === "primary")?.hex).toBe("#5E6AD2");
  });

  it("accepts a monochrome CTA that stands out from the page", () => {
    const { roles } = assignRoles({ ...base, clusters: [], ctas: [{ bg: "rgb(23,23,23)", label: "Sign Up" }] });
    expect(roles.find((r) => r.role === "primary")?.hex).toBe("#171717");
  });

  it("derives surface/border when the page has a single background", () => {
    const { roles } = assignRoles({ clusters: [], ctas: [], cssVars: {}, backgrounds: toWeightedHex({ "#ffffff": 1 }), texts: toWeightedHex({ "#000": 1 }), borders: [] });
    expect(roles.find((r) => r.role === "surface")?.derived).toBe(true);
    expect(roles.find((r) => r.role === "border")?.derived).toBe(true);
  });
});
