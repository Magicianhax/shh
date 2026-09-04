import { JobTimeline } from "./JobTimeline";
import type { JobRow } from "../hooks/useJobs";
import { countdown, labelText, num, solText } from "../lib/format";

type Props = {
  row: JobRow;
  selected: boolean;
  now: number;
  /** `Escrow.paid` when known, so the card's final step can read "settled". */
  paid?: boolean;
  onSelect: () => void;
};

export function JobCard({ row, selected, now, paid, onSelect }: Props) {
  const job = row.account;
  const model = labelText(job.modelLabel) || "unlabelled model";
  const msLeft = num(job.deadlineUnix) * 1000 - now;
  const urgent = msLeft > 0 && msLeft < 5 * 60_000;

  return (
    <button type="button" className="card" aria-selected={selected} onClick={onSelect}>
      <div className="card-top">
        <span className="card-model">{model}</span>
        <span className="card-price">
          {solText(job.priceLamports)}
          <small>SOL</small>
        </span>
      </div>

      <div className="card-meta">
        <span className={urgent ? "urgent" : undefined}>{countdown(job.deadlineUnix, now)}</span>
        <i className="dot-sep" />
        <span>{row.layer === "er" ? "on rollup" : "on devnet"}</span>
      </div>

      <JobTimeline job={job} paid={paid} />
    </button>
  );
}
