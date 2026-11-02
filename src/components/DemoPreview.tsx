"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildDemoHtml } from "@/lib/demo/generate";
import type { BrandGuide } from "@/lib/types";
import { Monitor, Phone } from "./icons";

const DESKTOP_W = 1280;
const DESKTOP_H = 860;
const MOBILE_W = 390;
const MOBILE_H = 760;

export default function DemoPreview({ brand }: { brand: BrandGuide }) {
  const [mode, setMode] = useState<"desktop" | "mobile">("desktop");
  const [width, setWidth] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => buildDemoHtml(brand), [brand]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const frameW = mode === "desktop" ? DESKTOP_W : MOBILE_W;
  const frameH = mode === "desktop" ? DESKTOP_H : MOBILE_H;
  const scale = width ? Math.min(1, width / frameW) : 1;

  return (
    <section aria-labelledby="demo-title" className="rounded-3xl border border-line bg-card p-6 sm:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Demo page</p>
          <h3 id="demo-title" className="mt-1.5 text-2xl font-semibold tracking-tight">
            Here&apos;s a new page in their brand
          </h3>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">
            Generated purely from the extracted tokens: logo, palette roles, fonts, radius, their headline and CTA copy. Text colours on coloured surfaces are picked by contrast.
          </p>
        </div>
        <div role="radiogroup" aria-label="Preview size" className="inline-flex rounded-full border border-line bg-[#fafaf8] p-1">
          {(["desktop", "mobile"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium capitalize transition ${
                mode === m ? "bg-white text-foreground shadow-sm ring-1 ring-line" : "text-muted hover:text-foreground"
              }`}
            >
              {m === "desktop" ? <Monitor width={14} height={14} /> : <Phone width={14} height={14} />}
              {m}
            </button>
          ))}
        </div>
      </div>

      <div ref={boxRef} className="w-full">
        <div
          className={`mx-auto overflow-hidden bg-white shadow-[0_20px_50px_-24px_rgba(0,0,0,0.35)] ${mode === "mobile" ? "rounded-[36px] border-[10px] border-[#18181b]" : "rounded-2xl border border-line"}`}
          style={{ width: frameW * scale + (mode === "mobile" ? 20 : 2), height: frameH * scale + (mode === "mobile" ? 20 : 2) + (mode === "desktop" ? 34 : 0) }}
        >
          {mode === "desktop" ? (
            <div className="flex h-[34px] items-center gap-1.5 border-b border-line bg-[#fafaf8] px-3" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-[#e5e4df]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#e5e4df]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#e5e4df]" />
              <span className="ml-3 truncate rounded bg-white px-2 py-0.5 text-[11px] text-muted ring-1 ring-line">new.{brand.domain}</span>
            </div>
          ) : null}
          <iframe
            key={mode}
            title={`Demo landing page for ${brand.name} (${mode})`}
            srcDoc={html}
            sandbox=""
            style={{ width: frameW, height: frameH, transform: `scale(${scale})`, transformOrigin: "0 0", border: 0, display: "block" }}
          />
        </div>
      </div>
    </section>
  );
}
