import { PublicKey } from "@solana/web3.js";
import { listOpenJobs } from "@inference-market/client";
import { log } from "./log";

/**
 * The floor half of a served model. `config.ServedModel` satisfies this; tests
 * pass the same shape without building a whole config.
 */
export type Floor = { floorLamports: number };

/** One open job this worker is willing to claim, with the model it asked for. */
export type Claimable = { job: PublicKey; modelId: string };

export type Discovery = {
  jobs: Claimable[];
  /** Jobs for a served model whose price was under that model's floor. */
  skippedUnderpriced: number;
};

/**
 * Decode a `model_label` back to the catalog id the requester chose.
 *
 * The on-chain field is a fixed 32-byte array, so it is zero-padded; the label
 * is everything before the first NUL. Whitespace is trimmed too, because an
 * older client wrote a space-padded label.
 */
export const decodeLabel = (bytes: ArrayLike<number>): string => {
  const arr = Array.from(bytes);
  const end = arr.indexOf(0);
  return Buffer.from(end === -1 ? arr : arr.slice(0, end))
    .toString("utf8")
    .trim();
};

/**
 * Every open job this worker should claim: one of its served models, priced at
 * or above that model's floor, and with more than `minTimeLeftS` left before
 * the deadline.
 *
 * Underpriced jobs are counted rather than claimed. They stay open for a
 * provider with a lower floor, which is the point of a floor.
 */
export async function findClaimable(
  er: any,
  served: ReadonlyMap<string, Floor>,
  minTimeLeftS: number,
): Promise<Discovery> {
  const now = Math.floor(Date.now() / 1000);
  const jobs: Claimable[] = [];
  let skippedUnderpriced = 0;

  for (const row of await listOpenJobs(er)) {
    const modelId = decodeLabel(row.account.modelLabel);
    const model = served.get(modelId);
    if (!model) continue;
    if (Number(row.account.deadlineUnix) - now <= minTimeLeftS) continue;
    if (Number(row.account.priceLamports) < model.floorLamports) {
      skippedUnderpriced += 1;
      continue;
    }
    jobs.push({ job: row.publicKey, modelId });
  }

  // Counts only: a label or a price is not private, but the log line stays
  // numeric so it can never grow into an account dump.
  if (skippedUnderpriced > 0) log("skipped underpriced", { jobs: skippedUnderpriced });

  return { jobs, skippedUnderpriced };
}
