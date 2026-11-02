"use client";

import { useCallback, useReducer, useRef } from "react";
import type { BrandGuide, ErrorCode, PartialEvent, ScanEvent, ShotEvent, StepEvent } from "@/lib/types";

export type ScanStatus = "idle" | "scanning" | "done" | "error";

export interface ScanState {
  status: ScanStatus;
  url: string;
  steps: StepEvent[];
  shots: Array<ShotEvent & { n: number }>;
  partial: Partial<BrandGuide>;
  brand: BrandGuide | null;
  error: { code: ErrorCode; message: string } | null;
  runId: number;
}

type Action =
  | { type: "reset" }
  | { type: "begin"; url: string }
  | { type: "event"; event: ScanEvent }
  | { type: "fail"; code: ErrorCode; message: string };

const initial: ScanState = { status: "idle", url: "", steps: [], shots: [], partial: {}, brand: null, error: null, runId: 0 };

function applyPartial(partial: Partial<BrandGuide>, e: PartialEvent): Partial<BrandGuide> {
  return { ...partial, [e.key]: e.value };
}

function reducer(state: ScanState, action: Action): ScanState {
  switch (action.type) {
    case "reset":
      return { ...initial, runId: state.runId };
    case "begin":
      return { ...initial, status: "scanning", url: action.url, runId: state.runId + 1 };
    case "fail":
      return { ...state, status: "error", error: { code: action.code, message: action.message } };
    case "event": {
      const e = action.event;
      switch (e.type) {
        case "start":
          return { ...state, url: e.url };
        case "step": {
          const idx = state.steps.findIndex((s) => s.id === e.id);
          const steps = idx >= 0 ? state.steps.map((s, i) => (i === idx ? e : s)) : [...state.steps, e];
          return { ...state, steps };
        }
        case "shot": {
          if (!e.data) return state;
          const n = (state.shots[state.shots.length - 1]?.n ?? 0) + 1;
          return { ...state, shots: [...state.shots.slice(-1), { ...e, n }] };
        }
        case "partial":
          return { ...state, partial: applyPartial(state.partial, e) };
        case "done":
          return { ...state, status: "done", brand: e.brand, partial: e.brand };
        case "error":
          return { ...state, status: "error", error: { code: e.code, message: e.message } };
      }
    }
  }
  return state;
}

export function useScan() {
  const [state, dispatch] = useReducer(reducer, initial);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (url: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    dispatch({ type: "begin", url });
    let terminal = false;
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
        signal: ctrl.signal,
      });
      // error responses (429 rate_limited) still carry an NDJSON error event
      const isNdjson = (res.headers.get("content-type") ?? "").includes("ndjson");
      if (!res.body || (!res.ok && !isNdjson)) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const event = JSON.parse(line) as ScanEvent;
          if (event.type === "done" || event.type === "error") terminal = true;
          dispatch({ type: "event", event });
        }
      }
      if (!terminal) dispatch({ type: "fail", code: "internal", message: "The connection closed before the scan finished." });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      dispatch({ type: "fail", code: "internal", message: err instanceof Error ? err.message : "Network error" });
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: "reset" });
  }, []);

  return { state, start, reset };
}
