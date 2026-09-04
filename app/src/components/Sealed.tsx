import { useState } from "react";
import { LockIcon, UnlockIcon } from "./icons";

type Props = {
  text: string;
  /** Shown in the footer, e.g. "Output · 1,204 bytes". */
  caption: string;
};

/**
 * Private text stays blurred until it is deliberately revealed. The bytes are
 * already in the DOM, so this is a shoulder-surfing guard rather than a
 * security boundary; the real boundary is the ER permission that let this
 * wallet read them at all. Nothing here logs or forwards the text.
 */
export function Sealed({ text, caption }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`seal${open ? " open" : ""}`}>
      <pre className="seal-body arriving" aria-hidden={!open}>
        {text}
      </pre>

      <div className="seal-lock">
        <LockIcon size={22} />
        <p>Visible only to the requester and the provider.</p>
      </div>

      <div className="seal-foot">
        {open ? <UnlockIcon /> : <LockIcon />}
        <span>{caption}</span>
        <span className="spacer" />
        <button type="button" className="btn btn-sm" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Reveal"}
        </button>
      </div>
    </div>
  );
}
