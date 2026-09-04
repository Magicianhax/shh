import { useEffect, useState } from "react";
import { assertTeeLive } from "@inference-market/client";

type Health = "checking" | "live" | "down";

const INTERVAL_MS = 30_000;

/**
 * Devnet TEE ephemeral-rollup health, polled from the MagicBlock status API
 * every 30 seconds. Everything on both pages runs through that rollup, so a red
 * beacon explains every failure below it. The ring pulses only while healthy.
 */
export function TeeBadge() {
  const [health, setHealth] = useState<Health>("checking");
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  useEffect(() => {
    let stopped = false;

    const check = async () => {
      try {
        await assertTeeLive();
        if (!stopped) setHealth("live");
      } catch {
        if (!stopped) setHealth("down");
      } finally {
        if (!stopped) setCheckedAt(new Date());
      }
    };

    void check();
    const id = window.setInterval(() => void check(), INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);

  const text =
    health === "live" ? "TEE rollup live" : health === "down" ? "TEE rollup down" : "Checking TEE";

  return (
    <span
      className="chip"
      title={checkedAt ? `Last checked ${checkedAt.toLocaleTimeString()}` : "Checking status"}
    >
      <i className={`beacon beacon-${health === "checking" ? "wait" : health}`} />
      {text}
    </span>
  );
}
