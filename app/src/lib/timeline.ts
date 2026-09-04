import { isTerminal, num, statusKey, titleCase } from "./format";

export type StepState = "future" | "current" | "done" | "skipped" | "failed";

export type Step = {
  label: string;
  state: StepState;
  /** True while this step is still working, so the rail carries a moving sheen. */
  pending: boolean;
};

const FAILED = new Set(["rejected", "cancelled", "expired"]);

/**
 * One job's whole life as six steps: Created → Open → Claimed → Submitted →
 * the decision → the payout.
 *
 * Which steps a job actually passed through is read from the account, not
 * guessed from the current status: `prompt_hash` is only set by
 * `finalize_prompt`, and `claimed_at` / `submitted_at` are only set by their
 * own instructions. A job cancelled straight out of Created therefore shows
 * Claimed and Submitted as skipped rather than as done.
 *
 * `paid` is `Escrow.paid`; pass `undefined` when the escrow has not been read.
 */
export function timeline(job: any, paid?: boolean): Step[] {
  const status = statusKey(job.status);
  const terminal = isTerminal(job.status);

  // `finalize_prompt` writes `prompt_hash` and flips the status to Open in the
  // same instruction, so a non-zero hash is exactly "this job reached Open".
  // Reading the status instead would mark a job cancelled straight out of
  // Created as having passed through Open.
  const sealed = Array.from(job.promptHash as number[]).some((b) => b !== 0);
  const reached = [
    true,
    sealed,
    num(job.claimedAt) > 0,
    num(job.submittedAt) > 0,
    terminal,
    paid === true,
  ];

  const labels = [
    "Created",
    "Open",
    "Claimed",
    "Submitted",
    terminal ? titleCase(status) : "Decision",
    paid ? "Settled" : "Settling",
  ];

  // The live step is the last one reached, except that a terminal job whose
  // escrow has not paid out yet is actively settling.
  const settling = terminal && paid === false;
  const current = settling ? 5 : reached.lastIndexOf(true);
  const pending = terminal ? settling : true;

  return labels.map((label, i) => {
    let state: StepState;
    if (i === current) state = "current";
    else if (i < current) state = reached[i] ? "done" : "skipped";
    else state = "future";

    if (i === 4 && FAILED.has(status) && (state === "current" || state === "done")) {
      state = "failed";
    }
    return { label, state, pending: i === current && pending };
  });
}
