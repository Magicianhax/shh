import { PublicKey, Connection } from "@solana/web3.js";
import { escrowPda, settleDirect, PROGRAM_ID, type AnyProgram } from "@inference-market/client";
import { log } from "./log";

/**
 * For every job we submitted output for, check whether it settled on its own
 * (via a scheduled Magic Action) and fall back to `settle_direct` if not.
 * Mutates `jobs`, removing entries that are closed or already paid.
 */
export async function reconcile(
  base: Connection,
  baseProgram: AnyProgram,
  payer: PublicKey,
  jobs: Set<string>,
): Promise<void> {
  for (const key of jobs) {
    const job = new PublicKey(key);
    const info = await base.getAccountInfo(job);
    if (!info) {
      jobs.delete(key); // closed
      continue;
    }
    if (!info.owner.equals(PROGRAM_ID)) continue; // still delegated
    const escrow: any = await baseProgram.account.escrow.fetch(escrowPda(job));
    if (escrow.paid) {
      jobs.delete(key);
      continue;
    }
    try {
      await settleDirect(baseProgram, payer, job);
      log("settled directly", { job: key });
      jobs.delete(key);
    } catch (e: any) {
      log("settle_direct failed", { job: key, err: String(e.message).slice(0, 120) });
    }
  }
}
