import { AUTO_APPROVE_SECS } from "@inference-market/client";
import { CheckIcon, LockIcon } from "./icons";
import type { ChatMsg } from "../lib/chat";
import { LAMPORTS, shortKey } from "../lib/format";
import { msText } from "../lib/latency";

type Props = {
  msg: ChatMsg;
  now: number;
  busy: boolean;
  onDecide: (kind: "approve" | "reject") => void;
};

/** "sealed ✓ · delegated ✓ 41 ms · permissions ✓ · prompt ✓ · waiting…" */
function stepLine(msg: ChatMsg): string {
  const steps = msg.steps ?? [];
  const parts = steps.map((s) => {
    if (s.failed) return `${s.name} ✗`;
    if (!s.done) return s.name;
    return s.ms !== null ? `${s.name} ✓ ${msText(s.ms)}` : `${s.name} ✓`;
  });
  if (msg.state === "open") parts.push("waiting for a provider…");
  if (msg.state === "claimed") {
    parts.push(`${msg.provider ? shortKey(msg.provider, 4) : "a provider"} is answering…`);
  }
  if (msg.state === "settling") parts.push("settling…");
  return parts.join(" · ");
}

export function Message({ msg, now, busy, onDecide }: Props) {
  if (msg.role === "user") {
    return (
      <div className="msg-user">
        <div>{msg.text}</div>
      </div>
    );
  }

  const price = (msg.priceLamports ?? 0) / LAMPORTS;
  const waiting =
    msg.state === "publishing" ||
    msg.state === "open" ||
    msg.state === "claimed" ||
    msg.state === "settling";

  const openAt = msg.deadlineUnix ? (msg.deadlineUnix + AUTO_APPROVE_SECS) * 1000 : null;
  const openInMin = openAt ? Math.max(0, Math.round((openAt - now) / 60000)) : null;

  return (
    <div className={`msg-bot${msg.state === "submitted" ? " fade" : ""}`}>
      <span className="mark" style={{ color: "oklch(99% 0.005 80)" }}>
        <LockIcon size={14} />
      </span>

      <div className="msg-body">
        {msg.text ? <div className="msg-text">{msg.text}</div> : null}

        {waiting ? (
          <>
            <span className="dots" aria-label="Working">
              <i />
              <i />
              <i />
            </span>
            <span className="steps-line">{stepLine(msg)}</span>
          </>
        ) : null}

        {msg.state === "submitted" ? (
          <div className="msg-actions">
            <button
              type="button"
              className="btn btn-acc"
              disabled={busy}
              onClick={() => onDecide("approve")}
            >
              Approve · pay {price.toFixed(3)} SOL
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => onDecide("reject")}
            >
              Reject · refund
            </button>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {msg.answeredMs !== null && msg.answeredMs !== undefined
                ? `answered in ${msText(msg.answeredMs)}`
                : "answered"}
              {openInMin !== null ? ` · open to anyone in ${openInMin} min` : ""}
            </span>
          </div>
        ) : null}

        {msg.state === "settled" || msg.state === "rejected" ? (
          <div className="msg-meta">
            <span className="ok">
              <span style={{ color: "var(--acc-deep)", display: "inline-flex" }}>
                <CheckIcon size={14} />
              </span>
              {msg.state === "settled"
                ? `Paid ${price.toFixed(3)} SOL · settled`
                : "Rejected · refunded"}
            </span>
            {msg.sig ? <span className="mono">{shortKey(msg.sig, 4)}</span> : null}
            {msg.provider ? <span>· {shortKey(msg.provider, 4)}</span> : null}
            {msg.answeredMs ? <span>· {msText(msg.answeredMs)}</span> : null}
          </div>
        ) : null}

        {msg.state === "failed" || msg.error ? (
          <p className="notice">{msg.error}</p>
        ) : null}
      </div>
    </div>
  );
}
