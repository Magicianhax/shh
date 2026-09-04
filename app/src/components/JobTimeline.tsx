import { motion } from "framer-motion";
import { EASE_OUT } from "../motion";
import { timeline } from "../lib/timeline";

type Props = {
  job: any;
  /** `Escrow.paid`, or undefined when the escrow has not been read yet. */
  paid?: boolean;
};

/**
 * The job's whole lifecycle as one horizontal stepper. Passed steps fill in
 * muted, the live step glows in the accent and carries a moving sheen while it
 * is still working, skipped steps stay grey, and a rejected, cancelled or
 * expired decision turns red.
 *
 * Rails fill with `scaleX` and the sheen translates, so a card full of these
 * costs no layout work.
 */
export function JobTimeline({ job, paid }: Props) {
  const steps = timeline(job, paid);
  const live = steps.find((s) => s.state === "current");

  return (
    <div className="timeline" role="img" aria-label={live ? `Lifecycle: ${live.label}` : "Lifecycle"}>
      {steps.map((s, i) => (
        <div key={i} className={`tstep ${s.state}`} title={s.label}>
          <div className="rail">
            <motion.i
              initial={false}
              animate={{ scaleX: s.state === "future" ? 0 : 1 }}
              transition={{ duration: 0.34, ease: EASE_OUT, delay: i * 0.03 }}
            />
            {s.state === "current" && s.pending ? (
              <motion.span
                className="sheen"
                initial={{ x: "-100%" }}
                animate={{ x: "320%" }}
                transition={{ repeat: Infinity, duration: 1.5, ease: EASE_OUT }}
              />
            ) : null}
          </div>
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}
