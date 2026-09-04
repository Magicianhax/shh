import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  baseConnection,
  authedTeeConnection,
  loadProgram,
  registerProvider,
  claimJob,
  readPrivate,
  submitOutput,
  providerPda,
  assertTeeLive,
  TEE_URL,
  type AnyProgram,
} from "@inference-market/client";
import { cfg } from "./config";
import { findClaimable } from "./discover";
import { runInference } from "./inference";
import { reconcile } from "./reconcile";
import { log, redact } from "./log";

/**
 * Every job this provider is on the hook for, read back from the base layer.
 *
 * The reconcile set is otherwise built only from jobs submitted in this
 * process, so a restart abandons every escrow the previous run left waiting for
 * a scheduled action that never ran. Two `all()` calls rather than one fetch per
 * job: the escrow's own `job` field is the join key.
 */
async function unpaidJobsOf(baseProgram: AnyProgram, wallet: PublicKey): Promise<string[]> {
  const [jobs, escrows] = await Promise.all([
    baseProgram.account.job.all(),
    baseProgram.account.escrow.all(),
  ]);
  const unpaid = new Set<string>(
    escrows
      .filter((e: any) => !e.account.paid)
      .map((e: any) => e.account.job.toBase58()),
  );
  return jobs
    .filter(
      (j: any) =>
        j.account.provider.equals(wallet) && unpaid.has(j.publicKey.toBase58()),
    )
    .map((j: any) => j.publicKey.toBase58());
}

async function main() {
  await assertTeeLive();
  const base = baseConnection();
  const baseProgram = loadProgram(
    new anchor.AnchorProvider(base, new anchor.Wallet(cfg.keypair), { commitment: "confirmed" }),
  );
  const tee = await authedTeeConnection(TEE_URL, cfg.keypair.publicKey, (m) =>
    Promise.resolve(nacl.sign.detached(m, cfg.keypair.secretKey)),
  );
  const er = loadProgram(
    new anchor.AnchorProvider(tee.connection, new anchor.Wallet(cfg.keypair), {
      commitment: "confirmed",
    }),
  );

  if (!(await base.getAccountInfo(providerPda(cfg.keypair.publicKey)))) {
    await registerProvider(baseProgram, cfg.keypair.publicKey, cfg.registerLabel);
    log("registered provider");
  }
  log("serving models", { models: cfg.served.size, provider: cfg.provider });

  const mine = new Set<string>();
  try {
    for (const key of await unpaidJobsOf(baseProgram, cfg.keypair.publicKey)) mine.add(key);
    log("reconcile set rebuilt", { jobs: mine.size });
  } catch (e) {
    log("reconcile rebuild failed", { err: redact(e) });
  }

  setInterval(
    () => reconcile(base, baseProgram, cfg.keypair.publicKey, mine).catch((e) => log("reconcile error", { err: String(e) })),
    cfg.reconcileMs,
  );

  for (;;) {
    try {
      const { jobs } = await findClaimable(er, cfg.served, cfg.minTimeLeftS);
      for (const { job, modelId } of jobs) {
        // Present because `findClaimable` only returns served models.
        const model = cfg.served.get(modelId)!;
        try {
          await claimJob(er, cfg.keypair.publicKey, job);
        } catch {
          continue; // raced by another provider
        }
        log("claimed", { job: job.toBase58(), model: modelId });
        const { prompt } = await readPrivate(er, job);
        const out = await runInference(new TextDecoder().decode(prompt), {
          ...cfg.inference,
          model: model.backendModel,
        });
        await submitOutput(er, cfg.keypair.publicKey, job, out);
        log("submitted", { job: job.toBase58(), bytes: out.length });
        mine.add(job.toBase58());
      }
    } catch (e: any) {
      log("loop error", { err: String(e.message).slice(0, 200) });
    }
    await new Promise((r) => setTimeout(r, cfg.pollMs));
  }
}

main().catch((e) => {
  // Never print the raw error: an ER failure carries the TEE endpoint, and the
  // endpoint carries the read auth token in its query string.
  console.error(redact(e));
  process.exit(1);
});
