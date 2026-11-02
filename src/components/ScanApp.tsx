"use client";

import { useRef, useState, type FormEvent } from "react";
import { FRIENDLY_ERRORS } from "@/lib/errors";
import type { ErrorCode } from "@/lib/types";
import DemoPreview from "./DemoPreview";
import ColorSection from "./guide/ColorSection";
import LogoSection from "./guide/LogoSection";
import { ExportSection, ImagerySection, UiSection, VoiceSection } from "./guide/OtherSections";
import { Section } from "./guide/primitives";
import TypographySection from "./guide/TypographySection";
import { ArrowRight, Refresh, Spinner, Warn } from "./icons";
import ScanPanel from "./ScanPanel";
import { useScan } from "./useScan";

const EXAMPLES = ["stripe.com", "linear.app", "vercel.com", "airbnb.com"];

function ErrorCard({ code, message, onRetry }: { code: ErrorCode; message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="animate-rise-in flex flex-col items-start gap-4 rounded-3xl border border-amber-200 bg-amber-50/60 p-6 sm:flex-row sm:items-center sm:p-8">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
        <Warn width={22} height={22} />
      </span>
      <div className="flex-1">
        <p className="text-lg font-semibold">{FRIENDLY_ERRORS[code]}</p>
        <p className="mt-1 text-sm text-muted">
          {message} <span className="font-mono text-xs">({code})</span>
        </p>
      </div>
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-foreground/85">
        <Refresh width={15} height={15} /> Try another URL
      </button>
    </div>
  );
}

export default function ScanApp() {
  const { state, start, reset } = useScan();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scanning = state.status === "scanning";
  const p = state.partial;
  const loading = state.status === "scanning";

  const run = (value: string) => {
    const v = value.trim();
    if (!v) return;
    void start(v);
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!scanning) run(input);
  };
  const retry = () => {
    reset();
    setInput("");
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => inputRef.current?.focus(), 300);
  };

  const canvas = p.colors?.roles.find((r) => r.role === "background")?.hex ?? "#ffffff";
  const showGuide = state.status !== "idle" && !(state.status === "error" && !p.colors);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
      <header className="flex items-center justify-between py-6">
        <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-foreground text-[13px] font-bold text-white">B</span>
          Brand Scraper
        </span>
        <span className="text-xs text-muted">Deterministic extraction · no AI</span>
      </header>

      <section className="mx-auto max-w-3xl pb-12 pt-10 text-center sm:pt-16">
        <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-6xl">Turn any website into a brand guideline</h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-muted text-pretty sm:text-lg">
          We open the site in a real browser, measure its colours, type, logo, UI and voice, then hand you a guideline and a fresh page built from it.
        </p>
        <form onSubmit={onSubmit} className="mx-auto mt-8 flex max-w-xl items-center gap-2 rounded-full border border-line bg-white p-1.5 pl-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_30px_-15px_rgba(0,0,0,0.2)] focus-within:ring-2 focus-within:ring-accent/40">
          <label htmlFor="url" className="sr-only">
            Website URL
          </label>
          <input
            id="url"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="yourbrand.com"
            autoComplete="url"
            inputMode="url"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none placeholder:text-[#a5a5a0]"
          />
          <button
            type="submit"
            disabled={!input.trim() || scanning}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {scanning ? (
              <>
                <Spinner width={15} height={15} /> Scanning…
              </>
            ) : (
              <>
                Extract brand <ArrowRight width={15} height={15} />
              </>
            )}
          </button>
        </form>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm text-muted">
          <span>Try:</span>
          {EXAMPLES.map((d) => (
            <button
              key={d}
              type="button"
              disabled={scanning}
              onClick={() => {
                setInput(d);
                run(d);
              }}
              className="rounded-full border border-line bg-white px-3 py-1 text-xs font-medium text-foreground transition hover:border-foreground/30 disabled:opacity-50"
            >
              {d}
            </button>
          ))}
        </div>
      </section>

      <div ref={panelRef} className="scroll-mt-6 space-y-6">
        {state.status !== "idle" ? <ScanPanel key={state.runId} state={state} /> : null}

        {state.status === "error" && state.error ? <ErrorCard code={state.error.code} message={state.error.message} onRetry={retry} /> : null}

        {showGuide ? (
          <div className="space-y-6 pt-6">
            <div className="flex items-end justify-between gap-4 px-1">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Brand guideline</p>
                <h2 className="mt-1 text-3xl font-semibold tracking-tight">{state.brand?.name ?? (scanning ? "Building guideline…" : "Partial results")}</h2>
              </div>
              {state.brand ? (
                <p className="hidden text-right text-xs text-muted sm:block">
                  {state.brand.finalUrl}
                  <br />
                  scanned in {(state.brand.durationMs / 1000).toFixed(1)}s
                </p>
              ) : null}
            </div>

            <Section id="logo" eyebrow="01 · Logo" title="Logo & icons" ready={!!p.logo} loading={loading} description="Best-scoring logo candidate on light and dark, plus the site's icon set.">
              {p.logo ? <LogoSection logo={p.logo} domain={state.brand?.domain ?? state.url.replace(/^https?:\/\/(www\.)?/, "")} /> : null}
            </Section>
            <Section id="colors" eyebrow="02 · Colour" title="Colour palette" ready={!!p.colors} loading={loading} description="Roles assigned from CTA backgrounds, CSS variables and area-weighted sampling. Click a swatch to copy its hex.">
              {p.colors ? <ColorSection palette={p.colors} /> : null}
            </Section>
            <Section id="type" eyebrow="03 · Typography" title="Typography" ready={!!p.typography} loading={loading} description="Families weighted by how much visible text uses them, loaded from the site's own font files where possible.">
              {p.typography ? <TypographySection typography={p.typography} /> : null}
            </Section>
            <Section id="ui" eyebrow="04 · UI elements" title="Buttons, links & tokens" ready={!!p.ui} loading={loading} description="Recreated from computed styles of the page's real buttons and links.">
              {p.ui ? <UiSection ui={p.ui} canvas={canvas} /> : null}
            </Section>
            <Section id="imagery" eyebrow="05 · Imagery" title="Imagery" ready={!!p.imagery} loading={loading}>
              {p.imagery ? <ImagerySection images={p.imagery} /> : null}
            </Section>
            <Section id="voice" eyebrow="06 · Voice & tone" title="Voice & tone" ready={!!p.voice} loading={loading} description="Heuristics over headings, CTAs and body copy: length, casing, punctuation and how often the copy says “you”.">
              {p.voice ? <VoiceSection voice={p.voice} /> : null}
            </Section>
            <Section id="export" eyebrow="07 · Export" title="Export tokens" ready={!!state.brand} loading={loading}>
              {state.brand ? <ExportSection brand={state.brand} /> : null}
            </Section>

            {state.brand ? <DemoPreview brand={state.brand} /> : null}
          </div>
        ) : null}
      </div>

      <footer className="mt-20 text-center text-xs text-muted">Runs locally with headless Chromium. Extracted assets belong to their owners.</footer>
    </main>
  );
}
