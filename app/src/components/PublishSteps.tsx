import { AnimatePresence, motion } from "framer-motion";
import { CheckIcon } from "./icons";
import { EASE_OUT, fast } from "../motion";

export type StepState = "idle" | "active" | "done" | "failed";

export type PublishStep = {
  name: string;
  state: StepState;
  /** Wall-clock milliseconds this step took, once it finished. */
  ms: number | null;
};

/** "412 ms" under a second, "3.4 s" over it. */
export const msText = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;

/**
 * The four steps of a publish, with how long each one actually took.
 *
 * The rails fill with `scaleX`, so nothing lays out per frame, and the active
 * rail carries a sheen that translates rather than a bar that grows.
 */
export function PublishSteps({ steps }: { steps: PublishStep[] }) {
  return (
    <div className="psteps">
      {steps.map((s) => (
        <div key={s.name} className={`pstep ${s.state}`}>
          <div className="track">
            <motion.i
              initial={false}
              animate={{ scaleX: s.state === "idle" ? 0 : 1 }}
              transition={{ duration: 0.34, ease: EASE_OUT }}
            />
            {s.state === "active" ? (
              <motion.span
                className="sheen"
                initial={{ x: "-100%" }}
                animate={{ x: "350%" }}
                transition={{ repeat: Infinity, duration: 1.15, ease: EASE_OUT }}
              />
            ) : null}
          </div>

          <span className="pstep-label">
            <AnimatePresence initial={false}>
              {s.state === "done" ? (
                <motion.span
                  key="check"
                  className="pstep-check"
                  initial={{ opacity: 0, scale: 0.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.4 }}
                  transition={fast}
                >
                  <CheckIcon size={11} />
                </motion.span>
              ) : null}
            </AnimatePresence>
            {s.name}
            {s.ms !== null ? (
              <motion.em
                className="pstep-ms"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={fast}
                style={{ fontStyle: "normal" }}
              >
                {msText(s.ms)}
              </motion.em>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}
