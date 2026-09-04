import { useState } from "react";
import type { ReactNode } from "react";
import { StatusPill } from "./StatusPill";
import { CheckIcon, CopyIcon, LinkIcon } from "./icons";
import type { JobRow } from "../hooks/useJobs";
import {
  explorerAddress,
  hexFull,
  hexPreview,
  isUnset,
  labelText,
  relTime,
  shortKey,
  solText,
  timeText,
} from "../lib/format";

export type EscrowView = { amount: { toString(): string }; paid: boolean } | null;

function Copy({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="iconbtn"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        });
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <span className="label">{label}</span>
      <div className="value">{children}</div>
    </div>
  );
}

type Props = {
  row: JobRow;
  escrow: EscrowView;
  /** Rendered under the facts grid: the actions available to this role. */
  children?: ReactNode;
};

/**
 * Everything public about one job. Private buffers are never rendered here —
 * the requester's decoded output lives in its own section on the Requester page.
 */
export function JobDetail({ row, escrow, children }: Props) {
  const job = row.account;
  const address = row.publicKey.toBase58();
  const claimed = !isUnset(job.provider);

  return (
    <section className="panel">
      <header className="detail-head">
        <div style={{ minWidth: 0 }}>
          <h2>{labelText(job.modelLabel) || "unlabelled model"}</h2>
          <p className="sub">
            {row.layer === "er"
              ? "Delegated to the TEE rollup"
              : "Owned by the program on devnet"}
          </p>
        </div>
        <div className="spacer" />
        <StatusPill status={job.status} paid={escrow?.paid} />
      </header>

      <div className="facts">
        <Fact label="Job account">
          <code className="mono">{shortKey(address, 6)}</code>
          <Copy text={address} label="job address" />
          <a
            className="iconbtn"
            href={explorerAddress(address)}
            target="_blank"
            rel="noreferrer"
            aria-label="Open job on Solana Explorer"
          >
            <LinkIcon />
          </a>
        </Fact>

        <Fact label="Price">
          <span>{solText(job.priceLamports)} SOL</span>
        </Fact>

        <Fact label="Escrow">
          {escrow ? (
            <span>
              {solText(escrow.amount)} SOL {escrow.paid ? "· paid out" : "· held"}
            </span>
          ) : (
            <span className="muted">closed or unread</span>
          )}
        </Fact>

        <Fact label="Requester">
          <code className="mono">{shortKey(job.requester, 6)}</code>
          <Copy text={job.requester.toBase58()} label="requester" />
        </Fact>

        <Fact label="Provider">
          {claimed ? (
            <>
              <code className="mono">{shortKey(job.provider, 6)}</code>
              <Copy text={job.provider.toBase58()} label="provider" />
            </>
          ) : (
            <span className="muted">unclaimed</span>
          )}
        </Fact>

        <Fact label="Deadline">
          <span>
            {timeText(job.deadlineUnix)} <span className="muted">({relTime(job.deadlineUnix)})</span>
          </span>
        </Fact>

        <Fact label="Created">
          <span>{timeText(job.createdAt)}</span>
        </Fact>

        <Fact label="Submitted">
          <span>{timeText(job.submittedAt)}</span>
        </Fact>

        <Fact label="Prompt hash">
          <code className="mono">{hexPreview(job.promptHash)}</code>
          <Copy text={hexFull(job.promptHash)} label="prompt hash" />
        </Fact>

        <Fact label="Output hash">
          <code className="mono">{hexPreview(job.outputHash)}</code>
          <Copy text={hexFull(job.outputHash)} label="output hash" />
        </Fact>
      </div>

      {children}
    </section>
  );
}
