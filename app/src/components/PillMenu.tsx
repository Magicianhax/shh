import { useEffect, useRef, useState } from "react";

export type PillOption = { label: string; value: string };

type Props = {
  label: string;
  value: string;
  options: PillOption[];
  onChange: (value: string) => void;
  /** Accessible name, e.g. "Model". */
  name: string;
  disabled?: boolean;
};

/**
 * A mono pill that opens a short list on click. Closes on Escape, on outside
 * click, and after a choice; every row is 44px so it is usable by thumb.
 */
export function PillMenu({ label, value, options, onChange, name, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!host.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={host} style={{ position: "relative" }}>
      <button
        type="button"
        className="pill"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${name}: ${label}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={name}
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: 0,
            zIndex: 20,
            minWidth: 168,
            padding: 6,
            borderRadius: 14,
            background: "var(--s1)",
            border: "1px solid var(--hair-2)",
            boxShadow: "0 18px 40px -26px oklch(40% 0.03 175)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className="conv"
              style={{ fontFamily: "var(--mono)", fontSize: 13 }}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
