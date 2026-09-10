import { MoonIcon, SunIcon } from "./icons";
import { useTheme } from "../hooks/useTheme";

/**
 * Light or dark, as a pressed state rather than a destination: the mark shows
 * the theme that is on, and aria-pressed says the same thing, so the two never
 * disagree. The visual stays small enough for the bars it sits in; a
 * pseudo-element carries the 44px target, the same trick as .help.
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";

  return (
    <button type="button" className="theme-toggle" aria-pressed={dark} onClick={toggle}>
      {dark ? <MoonIcon size={17} /> : <SunIcon size={17} />}
      <span className="sr-only">Dark theme</span>
    </button>
  );
}
