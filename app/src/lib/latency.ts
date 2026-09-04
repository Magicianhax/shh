import { useEffect, useState } from "react";

/**
 * The last measured rollup step, shared across the app.
 *
 * Every number the UI shows for latency comes from here, and every entry is
 * written by code that actually timed an ephemeral-rollup call. Nothing seeds
 * it, so before the first publish the UI shows an em dash rather than a
 * plausible-looking invention.
 */

let lastMs: number | null = null;
const listeners = new Set<(ms: number | null) => void>();

export function recordStep(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  lastMs = ms;
  for (const fn of listeners) fn(lastMs);
}

export function useLastStepMs(): number | null {
  const [ms, setMs] = useState(lastMs);
  useEffect(() => {
    listeners.add(setMs);
    return () => {
      listeners.delete(setMs);
    };
  }, []);
  return ms;
}

/** "412 ms" under a second, "3.4 s" over it. */
export const msText = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
