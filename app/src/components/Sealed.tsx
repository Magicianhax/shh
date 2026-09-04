import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LockIcon, UnlockIcon } from "./icons";
import { EASE_OUT, fast } from "../motion";

type Props = {
  text: string;
  /** Shown in the footer, e.g. "Output · 1,204 bytes". */
  caption: string;
};

/**
 * Private text stays blurred until it is deliberately revealed, then clears.
 * The bytes are already in the DOM, so this is a shoulder-surfing guard rather
 * than a security boundary; the real boundary is the ER permission that let
 * this wallet read them at all. Nothing here logs or forwards the text.
 *
 * The body also fades and rises the first time it mounts, which is when the
 * provider's answer arrives.
 */
export function Sealed({ text, caption }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="seal">
      <motion.pre
        className="seal-body"
        aria-hidden={!open}
        initial={{ opacity: 0, y: 10, filter: "blur(8px)" }}
        animate={{ opacity: open ? 1 : 0.5, y: 0, filter: open ? "blur(0px)" : "blur(7px)" }}
        transition={{ duration: 0.42, ease: EASE_OUT }}
      >
        {text}
      </motion.pre>

      <AnimatePresence>
        {!open ? (
          <motion.div
            className="seal-lock"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fast}
          >
            <LockIcon size={22} />
            <p>Visible only to requester and provider.</p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="seal-foot">
        {open ? <UnlockIcon /> : <LockIcon />}
        <span>{caption}</span>
        <span className="spacer" />
        <button type="button" className="btn btn-sm" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Reveal"}
        </button>
      </div>
    </div>
  );
}
