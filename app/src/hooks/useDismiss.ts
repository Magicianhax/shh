import { useEffect, type RefObject } from "react";

/**
 * Close an open popover on Escape or on a click outside `host`.
 *
 * Shared by every menu in the composer so they all dismiss the same way: a
 * picker that stays open after a click elsewhere reads as a stuck dialog.
 */
export function useDismiss(
  open: boolean,
  host: RefObject<HTMLElement | null>,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!host.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, host, close]);
}
