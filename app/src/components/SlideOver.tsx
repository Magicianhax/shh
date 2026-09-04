import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
};

/** How long the panel takes to slide out, matched to the CSS transition. */
const EXIT_MS = 280;

/**
 * Right-hand slide-over over a blurred scrim. Stays mounted for the length of
 * the exit transition so closing animates instead of snapping. Escape and a
 * scrim click both close it, and the page behind it stops scrolling while it
 * is open.
 */
export function SlideOver({ open, onClose, label, children }: Props) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Two frames: one to commit the mounted markup, one to flip the class so
      // the transition has a starting value to move from.
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setShown(false);
    const id = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <>
      <button
        type="button"
        className={`scrim${shown ? " in" : ""}`}
        aria-label="Close panel"
        onClick={onClose}
      />
      <aside
        className={`sheet${shown ? " in" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {children}
      </aside>
    </>
  );
}
