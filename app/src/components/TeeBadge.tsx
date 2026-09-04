import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ROUTER_URL, TEE_URL, assertTeeLive } from "@inference-market/client";
import { fast } from "../motion";

type Health = "checking" | "live" | "down";

const INTERVAL_MS = 30_000;

/** Host only. These are the public endpoints; the authenticated ER URL, which
 *  carries the read token, is never rendered anywhere. */
const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * Devnet TEE ephemeral-rollup health, polled from the MagicBlock status API
 * every 30 seconds. Everything below it runs through that rollup, so a red
 * beacon explains every failure on the page. The ring pulses only while healthy.
 */
export function TeeBadge() {
  const [health, setHealth] = useState<Health>("checking");
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [open, setOpen] = useState(false);

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
    <div
      className="tip-host"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="chip"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
      >
        <i className={`beacon beacon-${health === "checking" ? "wait" : health}`} />
        <span className="chip-label">{text}</span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.dl
            className="tip"
            role="tooltip"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={fast}
          >
            <dt>Region</dt>
            <dd>{host(TEE_URL)}</dd>
            <dt>Router</dt>
            <dd>{host(ROUTER_URL)}</dd>
            <dt>Last check</dt>
            <dd>{checkedAt ? checkedAt.toLocaleTimeString() : "running"}</dd>
          </motion.dl>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
