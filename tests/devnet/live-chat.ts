/**
 * Live loop against devnet along the exact path the web app takes.
 *
 * `live-worker.ts` drives the scripted flow (`createJob` then `publishJob`);
 * this one drives the batched flow the chat UI uses — `openJob` packs
 * `create_job`, both delegations and the action-escrow top-up into one signing
 * round, then `sealPrompt` runs the whole rollup sequence in a second one. That
 * is the path that produced "Blockhash not found" in the browser, so it is the
 * path that has to be exercised on devnet.
 *
 * A separately running provider worker must be claiming jobs.
 *
 * Run: node node_modules/tsx/dist/cli.mjs tests/devnet/live-chat.ts [model-id]
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import fs from "node:fs";
import {
  ACTION_TOP_UP_LAMPORTS,
  assertTeeLive,
  authedTeeConnection,
  baseConnection,
  closeJob,
  escrowPda,
  finishJob,
  jobPrivatePda,
  loadProgram,
  modelById,
  openJob,
  priceLamports,
  readPrivate,
  routerConnection,
  sealPrompt,
  settleDirect,
  teeIdentity,
  waitForDelegation,
  waitForUndelegation,
  DEFAULT_MODEL_ID,
  TEE_URL,
} from "@inference-market/client";

const modelId = process.argv[2] ?? DEFAULT_MODEL_ID;
const found = modelById(modelId);
if (!found) throw new Error(`unknown model id ${modelId}`);
// Bound after the check so the narrowing survives into the function below;
// TypeScript re-widens a module-level binding inside a closure.
const spec = found;

const requester = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"))),
);
const signer = (kp: Keypair) => (m: Uint8Array) =>
  Promise.resolve(nacl.sign.detached(m, kp.secretKey));
const statusOf = (j: any) => Object.keys(j.status)[0] as string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The same provider options the browser builds: Anchor's defaults. The base
 * flows that need a finalized blockhash draw one themselves, so this script
 * exercises that split rather than papering over it here.
 */
const mkProvider = (conn: Connection, kp: Keypair) =>
  new anchor.AnchorProvider(conn, new anchor.Wallet(kp), { commitment: "confirmed" });

async function main() {
  await assertTeeLive();
  const base = baseConnection();
  const router = routerConnection();
  const validator = await teeIdentity(TEE_URL);
  const baseProg = loadProgram(mkProvider(base, requester));
  const tee = await authedTeeConnection(TEE_URL, requester.publicKey, signer(requester));
  const erProg = loadProgram(mkProvider(tee.connection, requester));

  const price = priceLamports(spec);
  const nonce = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
  const deadline = Math.floor(Date.now() / 1000) + 900;
  const prompt = new TextEncoder().encode(
    "You are answering inside a private inference marketplace. Reply directly.\n\n" +
      "User: In one sentence, say what an ephemeral rollup is.",
  );

  // Top up the action escrow only when it is empty, exactly as the chat does.
  const escrowInfo = await base.getAccountInfo(escrowPda(baseProg.programId));
  const topUp = escrowInfo ? 0 : ACTION_TOP_UP_LAMPORTS;

  console.log(`model ${spec.id} · price ${(price / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  const t0 = Date.now();
  const { job, sigs, sizes } = await openJob(
    baseProg,
    requester.publicKey,
    nonce,
    price,
    deadline,
    spec.id,
    validator,
    topUp,
  );
  console.log(
    `openJob · ${sigs.length} tx (${sizes.join(", ")} B) · ${Date.now() - t0} ms · job ${job.toBase58()}`,
  );

  const t1 = Date.now();
  await waitForDelegation(router, [job, jobPrivatePda(job)]);
  const { mode } = await sealPrompt(erProg, requester.publicKey, job, prompt);
  console.log(`sealPrompt · ${mode} · ${Date.now() - t1} ms`);

  let last = "";
  const t2 = Date.now();
  for (;;) {
    const j: any = await erProg.account.job.fetch(job);
    const s = statusOf(j);
    if (s !== last) {
      console.log(`  ${s} (+${Date.now() - t2} ms)`);
      last = s;
    }
    if (s === "submitted") break;
    if (Date.now() - t2 > 240_000) {
      throw new Error(`no answer after 240 s (status ${s}); is the worker running?`);
    }
    await sleep(2000);
  }

  const { output } = await readPrivate(erProg, job);
  const text = new TextDecoder().decode(output);
  console.log(`answer ${output.length} B · ${JSON.stringify(text.slice(0, 120))}…`);

  const providerWallet = ((await erProg.account.job.fetch(job)) as any).provider as PublicKey;
  const before = await base.getBalance(providerWallet);
  // `true` schedules the Magic Action, which is what the chat's approve does.
  await finishJob(erProg, requester.publicKey, job, "approve", true);
  await waitForUndelegation(base, job);

  // The scheduled action normally pays inside the commitment transaction. Give
  // it a moment before falling back, and treat either outcome as a pass.
  let paidBy = "magic action";
  let escrow: any = await baseProg.account.escrow.fetch(escrowPda(job));
  for (let i = 0; i < 10 && !escrow.paid; i++) {
    await sleep(500);
    escrow = await baseProg.account.escrow.fetch(escrowPda(job));
  }
  if (!escrow.paid) {
    try {
      await settleDirect(baseProg, requester.publicKey, job);
      paidBy = "direct settle";
    } catch (e: any) {
      if (!String(e?.message ?? e).includes("AlreadySettled")) throw e;
      paidBy = "provider reconcile";
    }
    escrow = await baseProg.account.escrow.fetch(escrowPda(job));
  }

  const after = await base.getBalance(providerWallet);
  if (!escrow.paid) throw new Error("escrow is not marked paid after settlement");
  console.log(
    `settled by ${paidBy} · provider +${((after - before) / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
  );
  await closeJob(baseProg, requester.publicKey, job);
  console.log("LIVE CHAT OK");
}

main().catch((e) => {
  console.error(String(e?.message ?? e).replace(/token=[^&\s]+/g, "token=…").slice(0, 900));
  process.exit(1);
});
