import { useCallback, useRef, useState } from "react";
import {
  PROVIDERS,
  PROVIDER_NAMES,
  modelById,
  modelsFor,
  priceLamports,
} from "@inference-market/client";
import { useDismiss } from "../hooks/useDismiss";
import { solText } from "../lib/format";

type Props = {
  /** Catalog id of the chosen model. */
  value: string;
  /** Called with the new catalog id; the caller also moves the price. */
  onChange: (id: string) => void;
  disabled?: boolean;
};

/**
 * The composer's model control: every catalog model, grouped by provider and
 * ordered lower → higher, each row carrying its tier and its price per message.
 *
 * The price is on the row because it is the thing that changes when you pick a
 * different model, and a picker that hid it would make the price pill jump for
 * no visible reason.
 */
export function ModelPicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, host, close);

  const current = modelById(value);
  const label = current?.name ?? value;

  return (
    <div ref={host} style={{ position: "relative" }}>
      <button
        type="button"
        className="pill"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Model: ${label}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>

      {open ? (
        <div role="listbox" aria-label="Model" className="picker">
          {PROVIDERS.map((p) => (
            <div className="picker-group" key={p}>
              <h5>{PROVIDER_NAMES[p]}</h5>
              {modelsFor(p).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={m.id === value}
                  className="picker-row"
                  title={m.note}
                  onClick={() => {
                    onChange(m.id);
                    close();
                  }}
                >
                  <span className="picker-name">
                    {m.name}
                    <em className={`tier tier-${m.tier}`}>{m.tier}</em>
                  </span>
                  <span className="picker-price mono">{solText(priceLamports(m))} SOL</span>
                  {m.note ? <span className="picker-note">{m.note}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
