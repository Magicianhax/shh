import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { fast } from "../motion";

export type ConfirmChoice = {
  id: string;
  label: string;
  /** Sentence shown while the choice waits for confirmation. */
  question: string;
  tone?: "primary" | "danger";
};

type Props = {
  choices: ConfirmChoice[];
  busy: string | null;
  onRun: (id: string) => void;
};

/**
 * Approve and reject sit side by side, and each asks once before it fires.
 * Both move money, and neither can be undone, so a slip on a trackpad should
 * not settle a job.
 */
export function ConfirmBar({ choices, busy, onRun }: Props) {
  const [pending, setPending] = useState<ConfirmChoice | null>(null);

  return (
    <AnimatePresence mode="wait" initial={false}>
      {pending ? (
        <motion.div
          key="confirm"
          className="confirm"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={fast}
        >
          <span className="confirm-q">{pending.question}</span>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setPending(null)}
            disabled={busy !== null}
          >
            Back
          </button>
          <button
            type="button"
            className={`btn btn-sm ${pending.tone === "danger" ? "btn-danger" : "btn-primary"}`}
            disabled={busy !== null}
            onClick={() => {
              const id = pending.id;
              setPending(null);
              onRun(id);
            }}
          >
            {busy === pending.id ? <i className="spin" /> : null}
            Yes, {pending.label.toLowerCase()}
          </button>
        </motion.div>
      ) : (
        <motion.div
          key="choices"
          className="actions"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={fast}
        >
          {choices.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`btn ${c.tone === "danger" ? "btn-danger" : "btn-primary"}`}
              disabled={busy !== null}
              onClick={() => setPending(c)}
            >
              {busy === c.id ? <i className="spin" /> : null}
              {c.label}
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
