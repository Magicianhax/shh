import { useState } from "react";
import { LockIcon } from "./icons";

type Props = {
  text: string;
  /** e.g. "Output · 412 bytes" */
  label: string;
  /** sha256 preview, already truncated */
  hash?: string;
  /** Who else can read it, for the veil line. */
  counterparty?: string;
};

/**
 * Private text behind a blur until it is deliberately revealed, then it clears
 * over 260 ms. The bytes are already in the DOM, so this is a shoulder-surfing
 * guard, not a security boundary; the real boundary is the rollup permission
 * that let this wallet read them. Nothing here logs or forwards the text.
 */
export function Sealed({ text, label, hash, counterparty }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="seal-head">
        <span className="cap">{label}</span>
        {hash ? (
          <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
            sha256 {hash}
          </span>
        ) : null}
      </div>

      <div className={`seal${open ? " open" : ""}`}>
        <div className="seal-text" aria-hidden={!open}>
          {text}
        </div>
        <div className="seal-veil">
          <span>
            <LockIcon size={16} />
            Visible only to you and {counterparty ?? "the provider"}
          </span>
          <button type="button" className="btn" onClick={() => setOpen(true)}>
            Reveal
          </button>
        </div>
      </div>

      {open ? (
        <button
          type="button"
          className="btn"
          style={{ alignSelf: "flex-start", minHeight: 44 }}
          onClick={() => setOpen(false)}
        >
          Hide again
        </button>
      ) : null}
    </div>
  );
}
