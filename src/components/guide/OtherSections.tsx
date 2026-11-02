/* eslint-disable @next/next/no-img-element -- remote imagery of arbitrary origin */
"use client";

import { useState, type CSSProperties } from "react";
import { prettyFamily, primaryFamily } from "@/lib/analyze/typography";
import { previewFamily } from "@/lib/fonts";
import { toCssVariables, toJson, toTailwindTheme } from "@/lib/export";
import type { BrandGuide, ButtonStyle, ImageAsset, UiElements, Voice } from "@/lib/types";
import { Chip, CopyButton, Empty } from "./primitives";

function buttonCss(b: ButtonStyle): CSSProperties {
  return {
    background: b.background,
    color: b.color,
    border: b.border,
    borderRadius: b.borderRadius,
    padding: b.padding === "0px 0px" ? "10px 16px" : b.padding,
    fontSize: b.fontSize,
    fontWeight: b.fontWeight,
    // prefer the proxied web font (registered by the typography section) when available
    fontFamily: `"${previewFamily(prettyFamily(primaryFamily(b.fontFamily)))}", ${b.fontFamily}`,
    textTransform: b.textTransform as CSSProperties["textTransform"],
    letterSpacing: b.letterSpacing === "normal" ? undefined : b.letterSpacing,
    boxShadow: b.boxShadow === "none" ? undefined : b.boxShadow,
    lineHeight: 1.2,
    minHeight: 36,
  };
}

function ButtonSpec({ title, b, canvas }: { title: string; b: ButtonStyle; canvas: string }) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">{title}</p>
      <div className="flex h-24 items-center justify-center rounded-xl" style={{ background: canvas }}>
        <span className="inline-flex items-center" style={buttonCss(b)}>
          {b.label}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] text-muted">
        <dt>background</dt>
        <dd className="truncate text-foreground">{b.background}</dd>
        <dt>text</dt>
        <dd className="text-foreground">{b.color}</dd>
        <dt>radius</dt>
        <dd className="text-foreground">{b.borderRadius}</dd>
        <dt>padding</dt>
        <dd className="text-foreground">{b.padding}</dd>
        <dt>font</dt>
        <dd className="text-foreground">
          {b.fontSize}px / {b.fontWeight}
        </dd>
      </dl>
    </div>
  );
}

export function UiSection({ ui, canvas }: { ui: UiElements; canvas: string }) {
  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-3">
        {ui.primaryButton ? <ButtonSpec title="Primary button" b={ui.primaryButton} canvas={canvas} /> : <Empty>No primary button found.</Empty>}
        {ui.secondaryButton ? <ButtonSpec title="Secondary button" b={ui.secondaryButton} canvas={canvas} /> : <Empty>No secondary button found.</Empty>}
        <div className="rounded-2xl border border-line p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Link</p>
          {ui.link ? (
            <div className="flex h-24 items-center rounded-xl px-4 text-sm" style={{ background: canvas }}>
              <p style={{ color: "inherit" }}>
                Read the{" "}
                <span style={{ color: ui.link.color, textDecoration: ui.link.textDecoration, fontWeight: ui.link.fontWeight }}>documentation</span> to learn
                more.
              </p>
            </div>
          ) : (
            <Empty>No inline links found.</Empty>
          )}
          {ui.link ? (
            <p className="mt-3 font-mono text-[11px] text-muted">
              {ui.link.color} · {ui.link.textDecoration} · {ui.link.fontWeight}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Radius</p>
          <div className="flex flex-wrap gap-3">
            {ui.radius.length ? (
              ui.radius.map((r) => (
                <div key={r.value} className="text-center">
                  <div className="h-14 w-14 border-2 border-foreground/70 bg-[#fafaf8]" style={{ borderRadius: r.value === "9999px" ? 9999 : r.value }} />
                  <p className="mt-1 font-mono text-[11px] text-muted">{r.value === "9999px" ? "pill" : r.value}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">Square corners throughout.</p>
            )}
          </div>
        </div>
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Spacing (4px grid)</p>
          <div className="space-y-1.5">
            {ui.spacing.map((s) => (
              <div key={s.value} className="flex items-center gap-3">
                <span className="w-12 font-mono text-[11px] text-muted">{s.value}</span>
                <span className="h-3 rounded-sm bg-accent/70" style={{ width: Math.min(parseFloat(s.value) * 2, 240) }} />
              </div>
            ))}
            {!ui.spacing.length ? <p className="text-sm text-muted">No spacing tokens detected.</p> : null}
          </div>
        </div>
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Shadows</p>
          <div className="grid grid-cols-2 gap-4">
            {ui.shadows.map((s, i) => (
              <div key={s.value} className="flex h-16 items-center justify-center rounded-xl bg-white text-[11px] text-muted" style={{ boxShadow: s.value }} title={s.value}>
                shadow-{i + 1}
              </div>
            ))}
            {!ui.shadows.length ? <p className="col-span-2 text-sm text-muted">Flat design, no shadows.</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ImagerySection({ images }: { images: ImageAsset[] }) {
  if (!images.length) return <Empty>No large content images on this page.</Empty>;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {images.map((img) => (
        <a key={img.src} href={img.src} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-xl border border-line bg-[#f3f3f0]">
          <img src={img.src} alt={img.alt} loading="lazy" referrerPolicy="no-referrer" className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.02]" />
        </a>
      ))}
    </div>
  );
}

export function VoiceSection({ voice }: { voice: Voice }) {
  const caseLabel = { sentence: "Sentence case", title: "Title Case", upper: "ALL CAPS", mixed: "Mixed case" }[voice.stats.caseStyle];
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Headlines</p>
        <blockquote className="text-2xl font-semibold leading-snug tracking-tight">“{voice.headline}”</blockquote>
        {voice.description ? <p className="mt-2 text-sm text-muted">{voice.description}</p> : null}
        {voice.headings.length ? (
          <ul className="mt-4 space-y-2 border-l-2 border-line pl-4 text-sm">
            {voice.headings.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Traits</p>
          <div className="flex flex-wrap gap-1.5">
            {voice.traits.length ? voice.traits.map((t) => <Chip key={t} tone="accent">{t}</Chip>) : <span className="text-sm text-muted">Not enough copy to judge.</span>}
          </div>
        </div>
        {voice.ctas.length ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">CTA labels</p>
            <div className="flex flex-wrap gap-1.5">
              {voice.ctas.map((c) => (
                <span key={c} className="rounded-full bg-foreground px-3 py-1 text-xs font-medium text-white">
                  {c}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {voice.keywords.length ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Keywords</p>
            <div className="flex flex-wrap gap-1.5">
              {voice.keywords.map((k) => (
                <Chip key={k}>{k}</Chip>
              ))}
            </div>
          </div>
        ) : null}
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-[#fafaf8] p-3">
            <dt className="text-[11px] text-muted">Avg. headline</dt>
            <dd className="font-semibold">{voice.stats.avgHeadlineWords} words</dd>
          </div>
          <div className="rounded-xl bg-[#fafaf8] p-3">
            <dt className="text-[11px] text-muted">Casing</dt>
            <dd className="font-semibold">{caseLabel}</dd>
          </div>
          <div className="rounded-xl bg-[#fafaf8] p-3">
            <dt className="text-[11px] text-muted">“You” per 100 words</dt>
            <dd className="font-semibold">{voice.stats.youRate}</dd>
          </div>
          <div className="rounded-xl bg-[#fafaf8] p-3">
            <dt className="text-[11px] text-muted">Exclamations</dt>
            <dd className="font-semibold">{Math.round(voice.stats.exclamationRate * 100)}% of sentences</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

const FORMATS = [
  { id: "css", label: "CSS variables", build: toCssVariables },
  { id: "json", label: "JSON", build: toJson },
  { id: "tailwind", label: "Tailwind theme", build: toTailwindTheme },
] as const;

export function ExportSection({ brand }: { brand: BrandGuide }) {
  const [tab, setTab] = useState<(typeof FORMATS)[number]["id"]>("css");
  const fmt = FORMATS.find((f) => f.id === tab) ?? FORMATS[0];
  const code = fmt.build(brand);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="inline-flex rounded-full border border-line bg-[#fafaf8] p-1">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={tab === f.id}
              type="button"
              onClick={() => setTab(f.id)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${tab === f.id ? "bg-white text-foreground shadow-sm ring-1 ring-line" : "text-muted hover:text-foreground"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <CopyButton text={code} label={`Copy ${fmt.label}`} />
      </div>
      <pre className="max-h-80 overflow-auto rounded-2xl bg-[#141416] p-5 font-mono text-[12.5px] leading-relaxed text-[#e8e8e3]">
        <code>{code}</code>
      </pre>
    </div>
  );
}
