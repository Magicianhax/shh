/**
 * A hold on background polling for as long as a transaction is in flight.
 *
 * The page polls three `getProgramAccounts` sweeps every eight seconds and a
 * chat tick every two. Measured on devnet, a preflight on a quiet connection is
 * rejected 0 times in 25; with those sweeps running alongside it, the same
 * endpoint rejects a perfectly live blockhash 16% of the time and a second
 * provider 24%. The reads are evidently enough to get the send served by a node
 * that has not caught up. So they stand aside while it matters.
 *
 * This is a hold, not a cancel: a tick that arrives during a send is dropped,
 * and the next one arrives on schedule. Nothing here is load-bearing for
 * correctness — the worst case if it fails open is what happens today.
 */
let holds = 0;
const listeners = new Set<() => void>();

/** True while at least one transaction is being built, signed or sent. */
export const rpcBusy = (): boolean => holds > 0;

/** Subscribe to changes, so a component can reflect the hold if it wants to. */
export function onRpcBusyChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) fn();
}

/**
 * Run `fn` with background polling held off.
 *
 * Nested and concurrent calls are counted rather than flagged, so two sends
 * overlapping does not let the first one to finish release the hold for both.
 */
export async function withRpcPriority<T>(fn: () => Promise<T>): Promise<T> {
  holds += 1;
  if (holds === 1) notify();
  try {
    return await fn();
  } finally {
    holds -= 1;
    if (holds === 0) notify();
  }
}

/**
 * Whether a background poll should run right now.
 *
 * Also false for a hidden tab: a backgrounded page has nobody reading it, and
 * its sweeps land on the same endpoint as the foreground tab that does.
 */
export function shouldPoll(): boolean {
  if (rpcBusy()) return false;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  return true;
}
