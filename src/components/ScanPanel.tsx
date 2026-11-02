"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StepEvent } from "@/lib/types";
import { Check, Spinner, Warn } from "./icons";
import type { ScanState } from "./useScan";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Reveals text over at most 600ms. */
export function Typewriter({ text, onProgress }: { text: string; onProgress?: () => void }) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const total = text.length;
    const duration = Math.min(600, total * 12);
    const startedAt = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - startedAt) / Math.max(1, duration));
      setShown(Math.ceil(p * total));
      onProgress?.();
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, reduced, onProgress]);
  const visible = reduced ? text : text.slice(0, shown);
  return (
    <span>
      {visible}
      <span className="sr-only">{reduced ? "" : text.slice(shown)}</span>
    </span>
  );
}

function StepRow({ step, onProgress }: { step: StepEvent; onProgress: () => void }) {
  return (
    <li className="animate-rise-in flex gap-3 py-2.5">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          step.status === "running"
            ? "text-muted"
            : step.status === "done"
              ? "bg-accent-soft text-accent"
              : "bg-amber-100 text-amber-700"
        }`}
      >
        {step.status === "running" ? <Spinner width={14} height={14} /> : step.status === "done" ? <Check width={12} height={12} strokeWidth={3} /> : <Warn width={12} height={12} />}
      </span>
      <div className="min-w-0 text-sm leading-relaxed">
        <p className="font-semibold text-foreground">{step.title}</p>
        {step.detail ? (
          <p className="mt-0.5 text-muted">
            <Typewriter text={step.detail} onProgress={onProgress} />
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function BrowserFrame({ state }: { state: ScanState }) {
  const latest = state.shots[state.shots.length - 1];
  let host = state.url;
  try {
    host = new URL(state.url).host + new URL(state.url).pathname.replace(/\/$/, "");
  } catch {
    /* keep raw */
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
      <div className="flex items-center gap-3 border-b border-line bg-[#fafaf8] px-4 py-2.5">
        <div className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[#e5e4df]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#e5e4df]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#e5e4df]" />
        </div>
        <div className="min-w-0 flex-1 truncate rounded-md bg-white px-3 py-1 text-center text-xs text-muted ring-1 ring-line">{host || "about:blank"}</div>
        {latest ? <span className="hidden text-[11px] text-muted sm:inline">{latest.label}</span> : null}
      </div>
      <div className="relative aspect-[16/10] bg-[#f3f3f0]">
        {state.shots.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted">
            {state.status === "error" ? (
              <span>No screenshot captured</span>
            ) : (
              <>
                <Spinner width={22} height={22} />
                <span>Capturing homepage…</span>
              </>
            )}
          </div>
        ) : (
          state.shots.map((s) => (
            // eslint-disable-next-line @next/next/no-img-element -- base64 screenshot from the stream
            <img
              key={s.n}
              src={`data:image/jpeg;base64,${s.data}`}
              alt={`Screenshot: ${s.label}`}
              className="animate-fade-in absolute inset-0 h-full w-full object-cover object-top"
            />
          ))
        )}
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: ScanState["status"] }) {
  if (status === "scanning")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
        <Spinner width={12} height={12} /> Scanning
      </span>
    );
  if (status === "done")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white">
        <Check width={12} height={12} strokeWidth={3} /> Complete
      </span>
    );
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
        <Warn width={12} height={12} /> Error
      </span>
    );
  return null;
}

export default function ScanPanel({ state }: { state: ScanState }) {
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const scrollToEnd = useCallback(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, []);
  useEffect(() => {
    scrollToEnd();
  }, [state.steps, scrollToEnd]);

  return (
    <section aria-label="Scan progress" className="grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_1fr]">
      <BrowserFrame state={state} />
      <div className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill status={state.status} />
          <span className="min-w-0 truncate text-sm text-muted">{state.url}</span>
        </div>
        <h2 className="mt-4 text-lg font-semibold tracking-tight">
          {state.status === "done" ? "Here's what we found" : state.status === "error" ? "The scan stopped" : "Reading the page…"}
        </h2>
        <div
          ref={logRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          className="mt-2 max-h-[420px] min-h-[220px] flex-1 overflow-y-auto pr-1"
          aria-live="polite"
        >
          <ol className="divide-y divide-line/70">
            {state.steps.map((s) => (
              <StepRow key={s.id} step={s} onProgress={scrollToEnd} />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
