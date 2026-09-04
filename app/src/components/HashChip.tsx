import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckIcon, CopyIcon } from "./icons";
import { fast } from "../motion";

type Props = {
  /** Shortened text shown in the chip. */
  text: string;
  /** Full value put on the clipboard. */
  full: string;
  label: string;
};

/** A monospace value with its own copy button and a confirmation tick. */
export function HashChip({ text, full, label }: Props) {
  const [copied, setCopied] = useState(false);

  return (
    <span className="hchip">
      <code>{text}</code>
      <button
        type="button"
        className="iconbtn"
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        onClick={() => {
          void navigator.clipboard?.writeText(full).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          });
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={copied ? "yes" : "no"}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={fast}
            style={{ display: "grid", placeItems: "center", color: copied ? "var(--ok)" : undefined }}
          >
            {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          </motion.span>
        </AnimatePresence>
      </button>
    </span>
  );
}
