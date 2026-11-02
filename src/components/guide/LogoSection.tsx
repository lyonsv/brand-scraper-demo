/* eslint-disable @next/next/no-img-element -- remote and data: brand assets of arbitrary origin */
"use client";

import type { LogoAsset, LogoSet } from "@/lib/types";
import { Download } from "../icons";
import { Empty } from "./primitives";

function downloadName(asset: LogoAsset, base: string): string {
  if (asset.kind === "svg") return `${base}-logo.svg`;
  if (asset.kind === "png") return `${base}-logo.png`;
  const ext = asset.src.match(/\.(png|jpe?g|webp|gif|svg)(\?|$)/i)?.[1] ?? "png";
  return `${base}-logo.${ext}`;
}

function LogoTile({ asset, dark }: { asset: LogoAsset; dark: boolean }) {
  // reverse single-tone logos that would vanish on this tile
  const reverse = (dark && asset.tone === "dark") || (!dark && asset.tone === "light");
  return (
    <div
      className={`relative flex h-40 items-center justify-center rounded-2xl p-8 ${dark ? "bg-[#111113]" : "border border-line bg-white"}`}
      style={dark ? undefined : { backgroundImage: "radial-gradient(#e9e9e5 1px, transparent 1px)", backgroundSize: "14px 14px" }}
    >
      <img
        src={asset.src}
        alt={asset.alt || "Logo"}
        referrerPolicy="no-referrer"
        className="max-h-16 max-w-[80%] object-contain"
        style={reverse ? { filter: dark ? "brightness(0) invert(1)" : "brightness(0)" } : undefined}
      />
      {reverse ? <span className={`absolute bottom-2 right-3 text-[10px] uppercase tracking-wider ${dark ? "text-white/50" : "text-muted"}`}>reversed</span> : null}
    </div>
  );
}

export default function LogoSection({ logo, domain }: { logo: LogoSet; domain: string }) {
  const base = domain.split(".")[0] || "brand";
  if (!logo.primary && logo.icons.length === 0) return <Empty>No logo or icons were found on this page.</Empty>;
  return (
    <div className="space-y-6">
      {logo.primary ? (
        <div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <LogoTile asset={logo.primary} dark={false} />
            <LogoTile asset={logo.primary} dark />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
            <span>
              Primary · {logo.primary.kind === "svg" ? "inline SVG" : logo.primary.kind === "png" ? "PNG capture" : "image"} · {logo.primary.width}×{logo.primary.height}
            </span>
            <span>Why: {logo.primary.reasons.join(", ")}</span>
            <span className="flex gap-3">
              {[logo.primary, ...logo.alternates.filter((a) => a.kind === "png")].map((a) => (
                <a
                  key={a.kind + a.src.slice(0, 40)}
                  href={a.src}
                  download={downloadName(a, base)}
                  target={a.src.startsWith("data:") ? undefined : "_blank"}
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                >
                  <Download width={13} height={13} /> {a.kind === "png" ? "PNG" : a.kind === "svg" ? "SVG" : "Image"}
                </a>
              ))}
            </span>
          </div>
        </div>
      ) : (
        <Empty>No convincing logo found in the header, showing icons instead.</Empty>
      )}

      {logo.alternates.filter((a) => a.kind !== "png").length ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Other candidates</p>
          <div className="flex flex-wrap gap-3">
            {logo.alternates
              .filter((a) => a.kind !== "png")
              .map((a, i) => (
                <div key={i} className="flex h-16 min-w-24 items-center justify-center rounded-xl border border-line bg-white px-4" title={a.reasons.join(", ")}>
                  <img src={a.src} alt={a.alt || "Logo candidate"} referrerPolicy="no-referrer" className="max-h-8 max-w-40 object-contain" />
                </div>
              ))}
          </div>
        </div>
      ) : null}

      {logo.icons.length ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Icon set</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            {logo.icons.map((icon) => (
              <a
                key={icon.href}
                href={icon.href}
                target="_blank"
                rel="noreferrer"
                className="group flex flex-col items-center gap-2 rounded-xl border border-line bg-white p-3 text-center transition hover:border-foreground/30"
              >
                <span className="flex h-14 w-full items-center justify-center">
                  <img src={icon.href} alt={icon.rel} referrerPolicy="no-referrer" className={icon.rel === "og:image" ? "max-h-14 max-w-full rounded object-cover" : "max-h-10 max-w-10 object-contain"} />
                </span>
                <span className="w-full truncate text-[11px] text-muted">
                  {icon.rel}
                  {icon.sizes ? ` · ${icon.sizes}` : ""}
                </span>
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
