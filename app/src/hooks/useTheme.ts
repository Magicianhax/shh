import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "shh-theme";

/** Kept in step with --canvas in index.css, for the browser's own chrome. */
const GROUND: Record<Theme, string> = { light: "#faf9f5", dark: "#171510" };

/** A stored choice, or null for "never chosen". Anything else counts as unset. */
function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    // Private mode or blocked storage: the choice lives for this session only.
    return null;
  }
}

function system(): Theme {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolve(): Theme {
  return stored() ?? system();
}

function apply(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", GROUND[theme]);
}

/**
 * Swap without a cross-fade. Every hover and focus transition in the sheet
 * would otherwise run at once and the whole page would smear on the way over,
 * so transitions are suspended for the two frames the repaint needs.
 */
function swap(theme: Theme) {
  const root = document.documentElement;
  root.classList.add("theme-swap");
  apply(theme);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.remove("theme-swap"));
  });
}

/**
 * The theme is an explicit choice if one is stored, and the OS preference
 * otherwise. The boot script in index.html has already written the attribute
 * before first paint; this hook keeps React in step with it and owns changes.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(resolve);

  // The attribute is the source of truth. Re-assert it in case the boot script
  // was blocked, and follow the OS while the visitor has made no choice.
  useEffect(() => {
    if (document.documentElement.getAttribute("data-theme") !== theme) apply(theme);

    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (stored()) return;
      const next = system();
      setTheme(next);
      swap(next);
    };
    mq.addEventListener("change", onSystemChange);
    return () => mq.removeEventListener("change", onSystemChange);
    // Runs once: the listener reads live state and does not close over `theme`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(() => {
    const next: Theme =
      document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Nothing to persist to; the toggle still works for this session.
    }
    swap(next);
    setTheme(next);
  }, []);

  return { theme, toggle };
}
