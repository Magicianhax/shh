import { forwardRef } from "react";
import { motion } from "framer-motion";
import { JobTimeline } from "./JobTimeline";
import { riseIn, springy } from "../motion";
import type { JobRow } from "../hooks/useJobs";
import { countdown, labelText, num, solText } from "../lib/format";

type Props = {
  row: JobRow;
  selected: boolean;
  now: number;
  /** `Escrow.paid` when known, so the card's final step can read "settled". */
  paid?: boolean;
  onSelect: () => void;
};

/**
 * `forwardRef` is required, not cosmetic: `AnimatePresence mode="popLayout"`
 * wraps each child in a measuring component that needs a ref on the DOM node.
 * Without it React warns and the exit animation cannot measure the card.
 */
export const JobCard = forwardRef<HTMLButtonElement, Props>(function JobCard(
  { row, selected, now, paid, onSelect },
  ref,
) {
  const job = row.account;
  const model = labelText(job.modelLabel) || "unlabelled model";
  const msLeft = num(job.deadlineUnix) * 1000 - now;
  const urgent = msLeft > 0 && msLeft < 5 * 60_000;

  return (
    <motion.button
      ref={ref}
      type="button"
      className="card"
      aria-selected={selected}
      onClick={onSelect}
      layout
      variants={riseIn}
      initial="hidden"
      animate="show"
      exit="exit"
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.995 }}
      transition={springy}
    >
      <div className="card-top">
        <span className="card-model">{model}</span>
        <span className="card-price">
          {solText(job.priceLamports)}
          <small>SOL</small>
        </span>
      </div>

      <div className="card-meta">
        <span className={urgent ? "urgent" : undefined}>{countdown(job.deadlineUnix, now)}</span>
        <i className="dot-sep" />
        <span>{row.layer === "er" ? "on rollup" : "on devnet"}</span>
      </div>

      <JobTimeline job={job} paid={paid} />
    </motion.button>
  );
});
