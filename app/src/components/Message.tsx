import { useState } from "react";
import { AUTO_APPROVE_SECS } from "@inference-market/client";
import { CheckIcon, LockIcon } from "./icons";
import type { ChatMsg } from "../lib/chat";
import { isEmptyAnswer } from "../lib/chat";
import { LAMPORTS, shortKey } from "../lib/format";
import { msText } from "../lib/latency";

type Props = {
  msg: ChatMsg;
  now: number;
  busy: boolean;
  /** True while this message's settle half is running in this session. */
  settleRunning: boolean;
  onDecide: (kind: "approve" | "reject") => void;
  onRetrySettle: () => void;
};

/** "sealing ✓ · delegating ✓ 41 ms · permissions ✓ · prompt ✓ · waiting…" */
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
  return parts.join(" · ");
}

export function Message({ msg, now, busy, settleRunning, onDecide, onRetrySettle }: Props) {
  const [trust, setTrust] = useState(false);
  if (msg.role === "user") {
    return (
      <div className="msg-user">
        <div>{msg.text}</div>
      </div>
    );
  }

  const price = (msg.priceLamports ?? 0) / LAMPORTS;
  const publishing =
    msg.state === "publishing" || msg.state === "open" || msg.state === "claimed";
  const settling = msg.state === "settling";
  /**
   * Settling with nothing running means the tab was closed or the conversation
   * switched mid-settlement. Say so and offer the retry; never resume on its own,
   * because that would prompt the wallet without the user asking.
   */
  const interrupted = settling && !settleRunning;
  /**
   * Also offered from "decision_failed". The decision can be on chain even when
   * `finishJob` threw, and in that case re-sending it is the wrong move: the
   * only thing left to do is settle the escrow.
   */
  const canRetrySettle =
    (settling || msg.state === "decision_failed") && Boolean(msg.decision);

  const openAt = msg.deadlineUnix ? (msg.deadlineUnix + AUTO_APPROVE_SECS) * 1000 : null;
  const openInMin = openAt ? Math.max(0, Math.round((openAt - now) / 60000)) : null;

  return (
    <div className={`msg-bot${msg.state === "submitted" ? " fade" : ""}`}>
      <span className="mark" style={{ color: "var(--on-acc)" }}>
        <LockIcon size={14} />
      </span>

      <div className="msg-body">
        {msg.text ? <div className="msg-text">{msg.text}</div> : null}

        {isEmptyAnswer(msg) ? (
          <p className="steps-line">the provider sealed an empty answer</p>
        ) : null}

        {publishing ? (
          <>
            <span className="dots" aria-label="Working">
              <i />
              <i />
              <i />
            </span>
            <span className="steps-line">{stepLine(msg)}</span>
          </>
        ) : null}

        {settling && !interrupted ? (
          <div className="msg-meta">
            <span className="ok">
              <i className="spin" style={{ color: "var(--acc)" }} />
              {msg.decision === "reject" ? "refunding…" : "settling…"}
            </span>
            {msg.sig ? <span className="mono">{shortKey(msg.sig, 4)}</span> : null}
          </div>
        ) : null}

        {interrupted && !msg.settleError ? (
          <p className="steps-line">
            settlement was interrupted · your {msg.decision === "reject" ? "rejection" : "approval"}
            {" "}is on chain, the payout is not finished
          </p>
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
            <button
              type="button"
              className="linky"
              aria-expanded={trust}
              aria-controls={`trust-${msg.id}`}
              onClick={() => setTrust((v) => !v)}
            >
              How does paying work?
            </button>
          </div>
        ) : null}

        {msg.state === "submitted" && trust ? (
          <div id={`trust-${msg.id}`} className="trust">
            <p>
              <b>You already paid.</b> The price left your wallet when you sent the
              message and has sat in an escrow account owned by the program ever since.
              The provider only spent a model call because they could see it was funded.
            </p>
            <p>
              <b>Approve</b> releases that escrow to the provider. <b>Reject</b> sends it
              back to you. Nothing further leaves your wallet either way.
            </p>
            <p>
              An hour after the deadline anyone can approve, so a provider is not stranded
              if you never come back.
            </p>
            <p className="trust-gap">
              <b>What this does not do yet.</b> Nothing stops a requester reading a good
              answer and rejecting anyway, keeping both the answer and the refund. The
              only consequence is the provider’s public rejected count. There is no
              arbitration and no staking in this version.
            </p>
          </div>
        ) : null}

        {msg.state === "decision_failed" ? (
          <>
            <p className="notice">{msg.error}</p>
            <div className="msg-actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => onDecide(msg.decision ?? "approve")}
              >
                Try again
              </button>
            </div>
          </>
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

        {msg.settleError ? <p className="notice">{msg.settleError}</p> : null}

        {/* Available for the whole of "settling", not only after a failure. */}
        {canRetrySettle ? (
          <div className="msg-actions">
            <button
              type="button"
              className="btn"
              disabled={settleRunning}
              onClick={onRetrySettle}
            >
              {settleRunning ? "Settling…" : "Settle now"}
            </button>
          </div>
        ) : null}

        {msg.state === "failed" && msg.error ? <p className="notice">{msg.error}</p> : null}
      </div>
    </div>
  );
}
