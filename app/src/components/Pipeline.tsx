import { timeline } from "../lib/timeline";

type Props = {
  job: any;
  /** `Escrow.paid`, or undefined when the escrow has not been read. */
  paid?: boolean;
};

/**
 * Six flat segments: black for a step the job actually passed, accent for the
 * live one, red for a rejected, cancelled or expired decision, hairline for
 * what has not happened. The step data comes from `lib/timeline`, which reads
 * `prompt_hash`, `claimed_at` and `submitted_at` rather than guessing from the
 * current status.
 */
export function Pipeline({ job, paid }: Props) {
  const steps = timeline(job, paid);
  const live = steps.find((x) => x.state === "current");

  return (
    <div className="pipe" role="img" aria-label={live ? `Pipeline: ${live.label}` : "Pipeline"}>
      {steps.map((x, i) => (
        <i
          key={i}
          className={
            x.state === "failed"
              ? "bad"
              : x.state === "current"
                ? "now"
                : x.state === "done" || x.state === "skipped"
                  ? "done"
                  : ""
          }
          title={x.label}
        />
      ))}
    </div>
  );
}

/** The state word beside the pipeline, in the same vocabulary. */
export function StateWord({ job, paid }: Props) {
  const steps = timeline(job, paid);
  const live = steps.find((x) => x.state === "current");
  const failed = live?.state === "failed" || steps.some((x) => x.state === "failed");
  const label = live?.label ?? "Created";

  return (
    <span className={`state${failed ? " bad" : live?.pending ? " now" : ""}`}>
      <i className={`dot ${failed ? "dot-bad" : live?.pending ? "dot-acc" : "dot-ink"}`} />
      {label}
    </span>
  );
}
