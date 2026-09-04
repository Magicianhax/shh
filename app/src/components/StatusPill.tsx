import type { AnchorEnum } from "../lib/format";
import { isTerminal, statusKey, titleCase } from "../lib/format";

const TONE: Record<string, string> = {
  created: "idle",
  open: "idle",
  claimed: "info",
  submitted: "warn",
  approved: "ok",
  rejected: "bad",
  cancelled: "bad",
  expired: "bad",
};

type Props = {
  status: AnchorEnum;
  /** `Escrow.paid`. Omit when the escrow has not been read yet. */
  paid?: boolean;
};

/**
 * Job state, plus where the money is. A terminal job whose escrow is still
 * unpaid is "settling": the commit landed but nothing has been paid out yet.
 */
export function StatusPill({ status, paid }: Props) {
  const key = statusKey(status);
  const tone = TONE[key] ?? "idle";
  const suffix =
    paid === undefined || !isTerminal(status) ? null : paid ? " · settled" : " · settling";

  return (
    <span className={`pill tone-${tone}`}>
      <i className="dot" />
      {titleCase(key)}
      {suffix ? <span className="suffix">{suffix}</span> : null}
    </span>
  );
}
