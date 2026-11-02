import { describe, expect, it } from "vitest";
import { deriveMuted } from "@/lib/analyze/color";
import { contrastRatio } from "@/lib/analyze/contrast";
import { assignRoles, toWeightedHex } from "@/lib/analyze/roles";
import { demoTokens } from "@/lib/demo/generate";
import type { BrandGuide } from "@/lib/types";

describe("derived muted keeps AA contrast", () => {
  it("uses a soft text colour unchanged (#777777 on white, Duolingo)", () => {
    expect(deriveMuted("#777777", "#FFFFFF")).toBe("#777777");
  });
  it("lightens strong text on white but stays ≥ 4.5:1", () => {
    const m = deriveMuted("#111111", "#FFFFFF");
    expect(m).not.toBe("#111111");
    expect(contrastRatio(m, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });
  it("darkens light text on a dark background but stays ≥ 4.5:1", () => {
    const m = deriveMuted("#F7F8F8", "#08090A");
    expect(m).not.toBe("#F7F8F8");
    expect(contrastRatio(m, "#08090A")).toBeGreaterThanOrEqual(4.5);
    expect(deriveMuted("#8A8F98", "#08090A")).toBe("#8A8F98");
  });
  it("assignRoles never derives an unreadable muted", () => {
    for (const [text, bg] of [
      ["#777777", "#FFFFFF"],
      ["#4B4B4B", "#FFFFFF"],
      ["#FFFFFF", "#121212"],
      ["#B3B3B3", "#121212"],
    ]) {
      const { roles } = assignRoles({
        clusters: [],
        ctas: [],
        cssVars: {},
        backgrounds: toWeightedHex({ [bg]: 1 }),
        texts: toWeightedHex({ [text]: 1 }),
        borders: [],
      });
      const muted = roles.find((r) => r.role === "muted")!;
      expect(contrastRatio(muted.hex, bg)).toBeGreaterThanOrEqual(Math.min(4.5, contrastRatio(text, bg)));
    }
  });
});

describe("demo text tokens have a contrast floor", () => {
  const roleOf = (role: string, hex: string) => ({ role, hex, oklch: { l: 0.5, c: 0, h: 0 }, reason: "", derived: false, onWhite: { ratio: 1, rating: "Fail" as const }, onBlack: { ratio: 1, rating: "Fail" as const }, onColor: "#000000" });
  it("lifts a too-light muted and checks it against the card surface too", () => {
    const b = {
      colors: { roles: [roleOf("background", "#FFFFFF"), roleOf("surface", "#F0F0F0"), roleOf("text", "#777777"), roleOf("muted", "#D4D4D4"), roleOf("primary", "#58CC02")], all: [], pairs: [], samplePoints: 0 },
      typography: { families: [], headingFamily: "x", bodyFamily: "x", scale: [], ratio: null, baseSize: 16 },
      ui: { primaryButton: null, secondaryButton: null, link: null, radius: [], spacing: [], shadows: [] },
    } as unknown as BrandGuide;
    const t = demoTokens(b);
    for (const fg of [t.text, t.muted]) {
      expect(contrastRatio(fg, t.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(fg, t.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
