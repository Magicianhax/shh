import { useEffect, useState } from "react";
import { ROUTER_URL, TEE_URL, assertTeeLive } from "@inference-market/client";
import { msText, useLastStepMs } from "../lib/latency";

const INTERVAL_MS = 30_000;

/** Host only. The authenticated rollup URL carries the read token and is never rendered. */
const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * Rollup health from the MagicBlock status API, plus the last step latency this
 * session actually measured. Shows an em dash until a real call has been timed.
 */
export function useTee() {
  const [live, setLive] = useState<boolean | null>(null);
  const ms = useLastStepMs();

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        await assertTeeLive();
        if (!stopped) setLive(true);
      } catch {
        if (!stopped) setLive(false);
      }
    };
    void check();
    const id = window.setInterval(() => void check(), INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);

  const state = live === null ? "Checking rollup" : live ? "TEE rollup live" : "TEE rollup down";

  return {
    live,
    ms,
    label: ms !== null ? `${state} · ${msText(ms)}` : state,
    detail: `region ${host(TEE_URL)} · router ${host(ROUTER_URL)}`,
  };
}
