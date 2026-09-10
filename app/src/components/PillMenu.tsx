import { useCallback, useRef, useState } from "react";
import { useDismiss } from "../hooks/useDismiss";

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
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, host, close);

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
            boxShadow: "var(--sh-pop)",
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
