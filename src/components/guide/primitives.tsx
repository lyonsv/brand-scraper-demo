"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CopyIcon } from "../icons";

export function useCopy(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = useCallback((key: string, text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1400);
  }, []);
  return [copied, copy];
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, copy] = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy("x", text)}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-foreground/30"
    >
      {copied ? <Check width={13} height={13} /> : <CopyIcon width={13} height={13} />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function Section({
  id,
  eyebrow,
  title,
  description,
  ready,
  loading,
  skeleton,
  actions,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  ready: boolean;
  loading: boolean;
  skeleton?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  if (!ready && !loading) return null;
  return (
    <section id={id} aria-labelledby={`${id}-title`} aria-busy={!ready} className="rounded-3xl border border-line bg-card p-6 sm:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">{eyebrow}</p>
          <h3 id={`${id}-title`} className="mt-1.5 text-2xl font-semibold tracking-tight">
            {title}
          </h3>
          {description ? <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p> : null}
        </div>
        {ready ? actions : null}
      </div>
      {ready ? <div className="animate-rise-in">{children}</div> : (skeleton ?? <DefaultSkeleton />)}
    </section>
  );
}

export function DefaultSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="skeleton h-28" />
      <div className="skeleton h-28" />
      <div className="skeleton h-28" />
    </div>
  );
}

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
        tone === "accent" ? "bg-accent-soft text-accent" : "border border-line bg-[#fafaf8] text-foreground"
      }`}
    >
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</p>;
}
