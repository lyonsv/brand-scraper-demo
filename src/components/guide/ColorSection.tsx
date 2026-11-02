"use client";

import type { ColorPalette, ColorRole, ContrastResult, Oklch } from "@/lib/types";
import { Check } from "../icons";
import { useCopy } from "./primitives";

export function oklchString(c: Oklch): string {
  return `oklch(${(c.l * 100).toFixed(1)}% ${c.c.toFixed(3)} ${c.h.toFixed(0)})`;
}

function Badge({ label, result }: { label: string; result: ContrastResult }) {
  const pass = result.rating !== "Fail";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
        pass ? "bg-accent-soft text-accent" : "bg-[#f3f3f0] text-muted"
      }`}
      title={`${result.ratio}:1 contrast on ${label}`}
    >
      {label} {result.ratio.toFixed(1)} <strong className="font-semibold">{result.rating}</strong>
    </span>
  );
}

function Swatch({ role, copied, onCopy }: { role: ColorRole; copied: boolean; onCopy: () => void }) {
  return (
    <button
      type="button"
      onClick={onCopy}
      title={`${role.reason} — click to copy ${role.hex}`}
      className="group overflow-hidden rounded-2xl border border-line bg-white text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-accent"
    >
      <div className="relative flex h-24 items-end p-3" style={{ background: role.hex, color: role.onColor }}>
        <span className="text-xs font-semibold capitalize opacity-90">{role.role}</span>
        {copied ? (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">
            <Check width={11} height={11} /> Copied
          </span>
        ) : null}
      </div>
      <div className="space-y-1.5 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-sm font-semibold">{role.hex}</span>
          {role.derived ? <span className="text-[10px] uppercase tracking-wider text-muted">derived</span> : null}
        </div>
        <p className="truncate font-mono text-[11px] text-muted">{oklchString(role.oklch)}</p>
        <div className="flex flex-wrap gap-1">
          <Badge label="white" result={role.onWhite} />
          <Badge label="black" result={role.onBlack} />
        </div>
      </div>
    </button>
  );
}

export default function ColorSection({ palette }: { palette: ColorPalette }) {
  const [copied, copy] = useCopy();
  const shown = palette.all.filter((c) => c.share >= 0.004);
  const total = shown.reduce((s, c) => s + c.share, 0) || 1;
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {palette.roles.map((r) => (
          <Swatch key={r.role} role={r} copied={copied === r.role} onCopy={() => copy(r.role, r.hex)} />
        ))}
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">All extracted colours · weighted by usage</p>
          <p className="text-xs text-muted">{palette.samplePoints.toLocaleString()} sampled points</p>
        </div>
        <div className="flex h-14 overflow-hidden rounded-xl border border-line">
          {shown.map((c) => (
            <button
              key={c.hex}
              type="button"
              onClick={() => copy(`all-${c.hex}`, c.hex)}
              title={`${c.hex} · ${(c.share * 100).toFixed(1)}%`}
              className="relative h-full min-w-[10px] transition-[flex-grow] hover:brightness-95"
              style={{ background: c.hex, flexGrow: Math.max(c.share / total, 0.012) * 100, flexBasis: 0 }}
            >
              {copied === `all-${c.hex}` ? <span className="absolute inset-x-0 bottom-1 text-center text-[10px] font-medium mix-blend-difference text-white">copied</span> : null}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {shown.slice(0, 12).map((c) => (
            <span key={c.hex} className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted">
              <span className="h-2.5 w-2.5 rounded-full border border-black/10" style={{ background: c.hex }} />
              {c.hex} {(c.share * 100).toFixed(1)}%
            </span>
          ))}
        </div>
      </div>

      {palette.pairs.length ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Contrast checks (WCAG 2)</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {palette.pairs.map((p) => (
              <div key={p.label} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
                <span className="flex h-9 w-12 items-center justify-center rounded-lg text-sm font-semibold" style={{ background: p.bgHex, color: p.fgHex }}>
                  Aa
                </span>
                <span className="flex-1 text-sm">{p.label}</span>
                <span className={`text-xs font-semibold tabular-nums ${p.result.rating === "Fail" ? "text-amber-700" : "text-accent"}`}>
                  {p.result.ratio.toFixed(2)} · {p.result.rating}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
