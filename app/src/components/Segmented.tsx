import type { CSSProperties } from "react";

export type SegOption = { label: string; value: string };

type Props = {
  options: SegOption[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
};

/**
 * Equal-width segments with a thumb that slides by translating one segment's
 * width, so selection never animates a layout property.
 */
export function Segmented({ options, value, onChange, label, disabled }: Props) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  return (
    <div
      className="seg"
      role="group"
      aria-label={label}
      style={{ "--seg-count": options.length, "--seg-index": index } as CSSProperties}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
