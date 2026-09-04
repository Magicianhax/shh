import { PublicKey } from "@solana/web3.js";
import { listOpenJobs, label32 } from "@inference-market/client";

/** Every open job matching `modelLabel` with more than `minTimeLeftS` left before its deadline. */
export async function findClaimable(
  er: any,
  modelLabel: string,
  minTimeLeftS: number,
): Promise<PublicKey[]> {
  const want = Buffer.from(label32(modelLabel));
  const now = Math.floor(Date.now() / 1000);
  return (await listOpenJobs(er))
    .filter((j) => Buffer.from(j.account.modelLabel).equals(want))
    .filter((j) => Number(j.account.deadlineUnix) - now > minTimeLeftS)
    .map((j) => j.publicKey);
}
