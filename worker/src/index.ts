import * as anchor from "@coral-xyz/anchor";
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
} from "@inference-market/client";
import { cfg } from "./config";
import { findClaimable } from "./discover";
import { runInference } from "./inference";
import { reconcile } from "./reconcile";
import { log } from "./log";

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
    await registerProvider(baseProgram, cfg.keypair.publicKey, cfg.modelLabel);
    log("registered provider");
  }

  const mine = new Set<string>();
  setInterval(
    () => reconcile(base, baseProgram, cfg.keypair.publicKey, mine).catch((e) => log("reconcile error", { err: String(e) })),
    cfg.reconcileMs,
  );

  for (;;) {
    try {
      for (const job of await findClaimable(er, cfg.modelLabel, cfg.minTimeLeftS)) {
        try {
          await claimJob(er, cfg.keypair.publicKey, job);
        } catch {
          continue; // raced by another provider
        }
        log("claimed", { job: job.toBase58() });
        const { prompt } = await readPrivate(er, job);
        const out = await runInference(new TextDecoder().decode(prompt), cfg.inference);
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
  console.error(e);
  process.exit(1);
});
