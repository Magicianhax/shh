import { timeline } from "../lib/timeline";

type Props = {
  job: any;
  /** `Escrow.paid`, or undefined when the escrow has not been read yet. */
  paid?: boolean;
};

/**
 * The job's whole lifecycle as one horizontal stepper. Passed steps fill in
 * muted, the live step glows in the accent and carries a moving sheen while it
 * is still working, skipped steps stay grey, and a rejected, cancelled or
 * expired decision turns red.
 */
export function JobTimeline({ job, paid }: Props) {
  const steps = timeline(job, paid);
  const live = steps.find((s) => s.state === "current");

  return (
    <div
      className="timeline"
      role="img"
      aria-label={live ? `Lifecycle: ${live.label}` : "Lifecycle"}
    >
      {steps.map((s, i) => (
        <div
          key={i}
          className={`tstep ${s.state}${s.pending ? " pending" : ""}`}
          title={s.label}
        >
          <div className="rail">
            <i />
          </div>
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}
