import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { HashChip } from "./HashChip";
import { JobTimeline } from "./JobTimeline";
import { StatusPill } from "./StatusPill";
import { CloseIcon, LinkIcon } from "./icons";
import { EASE_OUT } from "../motion";
import type { JobRow } from "../hooks/useJobs";
import {
  countdown,
  explorerAddress,
  hexFull,
  hexPreview,
  isUnset,
  labelText,
  shortKey,
  solText,
  timeText,
} from "../lib/format";

export type EscrowView = { amount: { toString(): string }; paid: boolean } | null;

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
  now: number;
  onClose: () => void;
  /** The private result, already decoded, sealed by the caller. */
  result: ReactNode;
  /** Role-specific controls, pinned to the bottom of the panel. */
  actions?: ReactNode;
};

/**
 * One job's public record, as the slide-over's contents. Private buffers are
 * never rendered here; the caller passes them in already wrapped in a seal.
 */
export function JobDetail({ row, escrow, now, onClose, result, actions }: Props) {
  const job = row.account;
  const address = row.publicKey.toBase58();
  const claimed = !isUnset(job.provider);

  const block = (i: number) => ({
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: 0.06 + i * 0.05, duration: 0.3, ease: EASE_OUT },
  });

  return (
    <>
      <header className="sheet-head">
        <div style={{ minWidth: 0 }}>
          <h2>{labelText(job.modelLabel) || "unlabelled model"}</h2>
          <p className="sub" style={{ marginTop: 4 }}>
            {solText(job.priceLamports)} SOL · {countdown(job.deadlineUnix, now)}
          </p>
        </div>
        <span className="spacer" />
        <StatusPill status={job.status} paid={escrow?.paid} />
        <button type="button" className="iconbtn" onClick={onClose} aria-label="Close panel">
          <CloseIcon />
        </button>
      </header>

      <div className="sheet-body">
        <motion.div className="block" {...block(0)}>
          <JobTimeline job={job} paid={escrow?.paid} />
        </motion.div>

        <motion.div className="block" {...block(1)}>
          <div className="block-head">
            <h3>Result</h3>
          </div>
          {result}
        </motion.div>

        <motion.div className="block" {...block(2)}>
          <div className="block-head">
            <h3>Record</h3>
          </div>
          <div className="facts">
            <Fact label="Job account">
              <HashChip text={shortKey(address, 6)} full={address} label="job address" />
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
              <HashChip
                text={shortKey(job.requester, 6)}
                full={job.requester.toBase58()}
                label="requester"
              />
            </Fact>

            <Fact label="Provider">
              {claimed ? (
                <HashChip
                  text={shortKey(job.provider, 6)}
                  full={job.provider.toBase58()}
                  label="provider"
                />
              ) : (
                <span className="muted">unclaimed</span>
              )}
            </Fact>

            <Fact label="Prompt hash">
              <HashChip
                text={hexPreview(job.promptHash)}
                full={hexFull(job.promptHash)}
                label="prompt hash"
              />
            </Fact>

            <Fact label="Output hash">
              <HashChip
                text={hexPreview(job.outputHash)}
                full={hexFull(job.outputHash)}
                label="output hash"
              />
            </Fact>

            <Fact label="Deadline">
              <span>{timeText(job.deadlineUnix)}</span>
            </Fact>

            <Fact label="Submitted">
              <span>{timeText(job.submittedAt)}</span>
            </Fact>
          </div>
        </motion.div>
      </div>

      {actions ? <div className="sheet-foot">{actions}</div> : null}
    </>
  );
}
