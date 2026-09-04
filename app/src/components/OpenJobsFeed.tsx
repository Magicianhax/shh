import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { StatusPill } from "./StatusPill";
import { riseIn } from "../motion";
import type { JobRow } from "../hooks/useJobs";
import { countdown, labelText, shortKey, solText } from "../lib/format";

type Props = {
  jobs: JobRow[] | null;
  now: number;
  error: string | null;
};

/**
 * Every job currently `Open` on the rollup, filterable by model label. This is
 * what a worker would claim next; claiming itself happens in the worker.
 */
export function OpenJobsFeed({ jobs, now, error }: Props) {
  const [filter, setFilter] = useState("");

  const shown = useMemo(() => {
    if (!jobs) return null;
    const q = filter.trim().toLowerCase();
    const rows = q
      ? jobs.filter((j) => labelText(j.account.modelLabel).toLowerCase().includes(q))
      : jobs;
    return rows.slice(0, 12);
  }, [jobs, filter]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Open jobs</h3>
        <span className="count">{shown ? shown.length : "—"}</span>
        <span className="spacer" />
        <input
          className="filter"
          value={filter}
          placeholder="Filter by model"
          aria-label="Filter open jobs by model label"
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {error ? (
        <div className="panel-body">
          <p className="note note-warn">{error}</p>
        </div>
      ) : shown === null ? (
        <div className="panel-body" style={{ display: "grid", gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <div className="sk" key={i} style={{ width: `${70 - i * 12}%` }} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="panel-body">
          <p className="sub">
            {filter.trim()
              ? "No open job matches that label right now."
              : "No open jobs on the rollup right now. Newly published jobs land here within a few seconds."}
          </p>
        </div>
      ) : (
        <div className="feed">
          <AnimatePresence initial={false}>
            {shown.map((j) => (
              <motion.div
                key={j.publicKey.toBase58()}
                className="feed-row"
                layout
                variants={riseIn}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                <StatusPill status={j.account.status} />
                <span className="feed-model">
                  {labelText(j.account.modelLabel) || "unlabelled"}
                </span>
                <span className="spacer" />
                <span className="feed-meta">{countdown(j.account.deadlineUnix, now)}</span>
                <span className="feed-meta">from {shortKey(j.account.requester)}</span>
                <span className="feed-meta" style={{ fontWeight: 600, color: "var(--ink)" }}>
                  {solText(j.account.priceLamports)} SOL
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
