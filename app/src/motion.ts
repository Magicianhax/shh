import type { Transition, Variants } from "framer-motion";

/**
 * Shared motion tokens. Everything here moves transform, opacity or filter, so
 * nothing triggers layout on a frame. Durations sit in the 150-260 ms band that
 * reads as responsive rather than choreographed.
 */

export const EASE_OUT = [0.2, 0.8, 0.3, 1] as const;

export const fast: Transition = { duration: 0.16, ease: EASE_OUT };
export const mid: Transition = { duration: 0.22, ease: EASE_OUT };
export const slow: Transition = { duration: 0.32, ease: EASE_OUT };

/** Panels and cards entering a list. */
export const riseIn: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.985 },
  show: { opacity: 1, y: 0, scale: 1, transition: mid },
  exit: { opacity: 0, y: -8, scale: 0.985, transition: fast },
};

/** Stagger container for a grid of cards. */
export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

/** The hero collapsing away once a wallet connects. */
export const heroExit: Variants = {
  show: { opacity: 1, y: 0, transition: slow },
  exit: { opacity: 0, y: -28, transition: { duration: 0.28, ease: EASE_OUT } },
};

/** Whole-page swap between the Requester and Provider tabs. */
export const pageSwap: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: mid },
  exit: { opacity: 0, y: -8, transition: fast },
};

export const springy: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.7 };
