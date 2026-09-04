/**
 * Live loop against devnet: this script is the requester; a separately running
 * provider worker (worker/) with a real model key must be claiming jobs.
 *
 *   1. create + publish a job labelled with a catalog model id, priced at the
 *      catalog price (so the worker's floor accepts it)
 *   2. wait for the worker to claim and answer it on the TEE rollup
 *   3. read the answer as the requester (length, hash, short excerpt)
 *   4. approve without a Magic Action, settle directly, close
 *
 * Never prints the prompt bytes or the TEE endpoint.
 *
 * Run: node node_modules/tsx/dist/cli.mjs tests/devnet/live-worker.ts [model-id]
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import fs from "node:fs";
import {
  assertTeeLive,
  baseConnection,
  routerConnection,
  teeIdentity,
  authedTeeConnection,
  loadProgram,
  createJob,
  publishJob,
  readPrivate,
  finishJob,
  settleDirect,
  closeJob,
  waitForUndelegation,
  escrowPda,
  sha256,
  modelById,
  priceLamports,
  DEFAULT_MODEL_ID,
  TEE_URL,
} from "@inference-market/client";

const modelId = process.argv[2] ?? DEFAULT_MODEL_ID;
const spec = modelById(modelId);
if (!spec) throw new Error(`unknown model id ${modelId}`);

const requester = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"))),
);
const signer = (kp: Keypair) => (m: Uint8Array) => Promise.resolve(nacl.sign.detached(m, kp.secretKey));
const mkProvider = (conn: Connection, kp: Keypair) =>
  new anchor.AnchorProvider(conn, new anchor.Wallet(kp), { commitment: "confirmed" });
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const statusOf = (j: any) => Object.keys(j.status)[0] as string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
      "User: In two sentences, explain why a trusted execution environment can keep a prompt private " +
      "from the operator of the machine it runs on.",
  );

  console.log(`model ${spec.id} (${spec.provider}, ${spec.tier}) · price ${(price / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  const t0 = Date.now();
  const { job } = await createJob(baseProg, requester.publicKey, nonce, price, deadline, spec.id);
  console.log(`job ${job.toBase58()} created (${Date.now() - t0} ms)`);
  const t1 = Date.now();
  const { fqdn } = await publishJob({ base: baseProg, er: erProg }, router, requester.publicKey, nonce, validator, prompt);
  console.log(`published on ${fqdn} (${Date.now() - t1} ms) · prompt ${prompt.length} B sha256 ${hex(sha256(prompt)).slice(0, 12)}…`);

  // wait for the worker
  let last = "";
  const t2 = Date.now();
  for (;;) {
    const j: any = await erProg.account.job.fetch(job);
    const s = statusOf(j);
    if (s !== last) {
      console.log(`  ${s}${s === "claimed" ? " by " + (j.provider as PublicKey).toBase58().slice(0, 8) + "…" : ""} (+${Date.now() - t2} ms)`);
      last = s;
    }
    if (s === "submitted") break;
    if (Date.now() - t2 > 240_000) throw new Error(`no answer after 240 s (status ${s}); is the worker running with a matching provider?`);
    await sleep(2000);
  }

  const { output } = await readPrivate(erProg, job);
  const text = new TextDecoder().decode(output);
  console.log(`answer ${output.length} B sha256 ${hex(sha256(output)).slice(0, 12)}…`);
  console.log(`excerpt: ${JSON.stringify(text.slice(0, 160))}${text.length > 160 ? "…" : ""}`);

  const providerWallet = ((await erProg.account.job.fetch(job)) as any).provider as PublicKey;
  const before = await base.getBalance(providerWallet);
  const { erSig, commitSig } = await finishJob(erProg, requester.publicKey, job, "approve", false);
  console.log(`approved · er ${erSig.slice(0, 12)}… · commit ${String(commitSig).slice(0, 12)}…`);
  await waitForUndelegation(base, job);
  await settleDirect(baseProg, requester.publicKey, job);
  const escrow: any = await baseProg.account.escrow.fetch(escrowPda(job));
  const after = await base.getBalance(providerWallet);
  console.log(`settled · escrow.paid=${escrow.paid} · provider +${((after - before) / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  await closeJob(baseProg, requester.publicKey, job);
  console.log("LIVE OK");
}

main().catch((e) => {
  console.error(String(e?.message ?? e).replace(/token=[^&\s]+/g, "token=…").slice(0, 600));
  process.exit(1);
});
