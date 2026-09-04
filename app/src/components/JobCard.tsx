import { StatusPill } from "./StatusPill";
import type { JobRow } from "../hooks/useJobs";
import { labelText, relTime, shortKey, solText } from "../lib/format";

type Props = {
  row: JobRow;
  selected: boolean;
  onSelect: () => void;
};

export function JobCard({ row, selected, onSelect }: Props) {
  const job = row.account;
  const model = labelText(job.modelLabel) || "unlabelled model";

  return (
    <button type="button" className="job" aria-selected={selected} onClick={onSelect}>
      <span className="job-title">
        <span className="name">{model}</span>
        <StatusPill status={job.status} />
      </span>
      <span className="job-meta">
        <code className="mono">{shortKey(row.publicKey)}</code>
        <span className="sep">/</span>
        <span>{row.layer === "er" ? "on rollup" : "on devnet"}</span>
        <span className="sep">/</span>
        <span>{relTime(job.deadlineUnix)}</span>
      </span>
      <span className="job-price">
        {solText(job.priceLamports)}
        <small>SOL</small>
      </span>
    </button>
  );
}
