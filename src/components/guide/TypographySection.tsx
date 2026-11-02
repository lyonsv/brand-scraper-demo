"use client";

import { familyStack, fontFaceCss, previewWeights } from "@/lib/fonts";
import type { Typography } from "@/lib/types";
import { Chip } from "./primitives";

const PANGRAM = "The quick brown fox jumps over the lazy dog";

export default function TypographySection({ typography }: { typography: Typography }) {
  const css = fontFaceCss(typography.families);
  const byName = new Map(typography.families.map((f) => [f.family, f]));
  return (
    <div className="space-y-8">
      {css ? <style>{css}</style> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {typography.families.map((f) => {
          const stack = familyStack(f);
          return (
            <div key={f.family} className="rounded-2xl border border-line p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold">{f.family}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    <span className="capitalize">{f.role}</span>
                    {f.usage ? ` · ${Math.round(f.usage * 100)}% of text` : ""} · {f.sources.length ? `web font, ${f.sources.length} file${f.sources.length === 1 ? "" : "s"}` : f.isSystem ? "system font" : "no downloadable source found"}
                  </p>
                </div>
                <span className="text-5xl leading-none" style={{ fontFamily: stack }}>
                  Aa
                </span>
              </div>
              <div className="mt-5 space-y-2">
                {previewWeights(f.weights).map((w) => (
                  <p key={w} className="flex items-baseline gap-3">
                    <span className="w-9 shrink-0 font-mono text-[11px] text-muted">{w}</span>
                    <span className="truncate text-xl" style={{ fontFamily: stack, fontWeight: w }}>
                      {PANGRAM}
                    </span>
                  </p>
                ))}
              </div>
              {f.weights.length ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {f.weights.map((w) => (
                    <Chip key={w}>{w}</Chip>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {typography.scale.length ? (
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Size scale</p>
            <p className="text-xs text-muted">
              base {typography.baseSize}px{typography.ratio ? ` · ≈${typography.ratio} ratio` : ""}
            </p>
          </div>
          <div className="divide-y divide-line rounded-2xl border border-line">
            {typography.scale.map((s) => {
              const fam = byName.get(s.family);
              return (
                <div key={s.tag} className="grid grid-cols-[56px_1fr] items-center gap-4 px-4 py-3 sm:grid-cols-[56px_150px_1fr]">
                  <span className="font-mono text-xs font-semibold uppercase text-muted">{s.tag}</span>
                  <span className="hidden font-mono text-[11px] text-muted sm:block">
                    {s.fontSize}px / {s.lineHeight === "normal" ? "normal" : s.lineHeight} · {s.fontWeight}
                  </span>
                  <span
                    className="col-span-2 truncate sm:col-span-1"
                    style={{
                      fontFamily: familyStack(fam),
                      fontSize: Math.min(s.fontSize, 56),
                      fontWeight: s.fontWeight,
                      letterSpacing: s.letterSpacing === "normal" ? undefined : s.letterSpacing,
                      lineHeight: 1.2,
                    }}
                    title={s.sample}
                  >
                    {s.sample || PANGRAM}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
