/**
 * Devnet end-to-end test against MagicBlock's TEE ephemeral rollup.
 *
 * Two jobs are driven through the whole lifecycle on real devnet:
 *   1. approve path  -> `approve_job(schedule_action = true)`, settled by the
 *      post-commit Magic Action if it runs, otherwise by `settle_direct`.
 *   2. reject path   -> `reject_job(schedule_action = false)`, always settled by
 *      `settle_direct` on the base layer after undelegation.
 *
 * Privacy gating is checked on the way through: an outsider and the provider
 * (before `claim_job`) must both fail to read `JobPrivate` from the TEE.
 *
 * Never prints the prompt or output bytes, and never prints the ER endpoint:
 * the TEE URL carries the auth token in its query string.
 *
 * Run: npm run test:devnet
 */
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { PERMISSION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import fs from "node:fs";
import assert from "node:assert/strict";
import {
  assertTeeLive,
  baseConnection,
  routerConnection,
  teeIdentity,
  authedTeeConnection,
  loadProgram,
  registerProvider,
  createJob,
  publishJob,
  claimJob,
  readPrivate,
  submitOutput,
  finishJob,
  settleDirect,
  closeJob,
  topUpActionEscrow,
  waitForUndelegation,
  listOpenJobs,
  escrowPda,
  providerPda,
  jobPrivatePda,
  permissionPda,
  sha256,
  PROGRAM_ID,
  TEE_URL,
  ROUTER_URL,
} from "@inference-market/client";

const KEYPAIR_PATH =
  process.env.REQUESTER_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`;
const requester = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8"))),
);
const providerKp = Keypair.generate();
const outsider = Keypair.generate();

/** Lamports handed to the throw-away provider / outsider keys. Not recovered. */
const PROVIDER_FUNDING = Number(process.env.PROVIDER_FUNDING ?? 0.1 * LAMPORTS_PER_SOL);
const OUTSIDER_FUNDING = Number(process.env.OUTSIDER_FUNDING ?? 0.01 * LAMPORTS_PER_SOL);
const PRICE = Number(process.env.JOB_PRICE ?? 0.005 * LAMPORTS_PER_SOL);
const DEADLINE_SECS = 1800;

const signer = (kp: Keypair) => (m: Uint8Array) =>
  Promise.resolve(nacl.sign.detached(m, kp.secretKey));
const mkProvider = (conn: Connection, kp: Keypair) =>
  new anchor.AnchorProvider(conn, new anchor.Wallet(kp), { commitment: "confirmed" });

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(6);
const step = (s: string) => console.log(`\n--- ${s}`);

// ---------------------------------------------------------------------------
// Diagnostics (runbook: router status -> base owner -> ER owner -> ER tx logs)
// ---------------------------------------------------------------------------

const DELEGATION_PROGRAM = "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh";

async function routerStatus(account: PublicKey): Promise<any> {
  const res = await fetch(`${ROUTER_URL.replace(/\/+$/, "")}/getDelegationStatus`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getDelegationStatus",
      params: [account.toBase58()],
    }),
  });
  return (await res.json() as any).result;
}

function ownerLabel(owner: PublicKey | undefined): string {
  if (!owner) return "<missing>";
  const s = owner.toBase58();
  if (s === PROGRAM_ID.toBase58()) return `${s} (inference_market)`;
  if (s === DELEGATION_PROGRAM) return `${s} (delegation program)`;
  return s;
}

/** Dump the full delegation picture for both PDAs of a job. */
async function diagnose(
  label: string,
  base: Connection,
  er: Connection,
  job: PublicKey,
): Promise<void> {
  console.error(`\n### diagnostics: ${label}`);
  for (const [name, pk] of [
    ["job", job],
    ["job_private", jobPrivatePda(job)],
  ] as [string, PublicKey][]) {
    try {
      const status = await routerStatus(pk);
      const b = await base.getAccountInfo(pk, "confirmed");
      const e = await er.getAccountInfo(pk, "confirmed");
      console.error(
        `  ${name} ${pk.toBase58()}\n` +
          `    router     : ${JSON.stringify(status)}\n` +
          `    base owner : ${ownerLabel(b?.owner)} (lamports ${b?.lamports ?? 0})\n` +
          `    ER owner   : ${ownerLabel(e?.owner)} (lamports ${e?.lamports ?? 0})`,
      );
    } catch (err) {
      console.error(`  ${name} ${pk.toBase58()} diagnostics failed:`, err);
    }
  }
  for (const [name, pk] of [
    ["job_permission", permissionPda(job)],
    ["job_private_permission", permissionPda(jobPrivatePda(job))],
  ] as [string, PublicKey][]) {
    try {
      const e = await er.getAccountInfo(pk, "confirmed");
      console.error(
        `  ${name} ${pk.toBase58()} ER: ${e ? ownerLabel(e.owner) : "<closed / absent>"}`,
      );
    } catch (err) {
      console.error(`  ${name} lookup failed:`, err);
    }
  }
}

type TxLogs = {
  err: unknown;
  logs: string[];
  permissionInvokes: number;
  permissionSuccesses: number;
};

async function txLogs(conn: Connection, sig: string): Promise<TxLogs | null> {
  const tx = await conn.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx?.meta) return null;
  const logs = tx.meta.logMessages ?? [];
  const perm = PERMISSION_PROGRAM_ID.toBase58();
  return {
    err: tx.meta.err,
    logs,
    permissionInvokes: logs.filter((l) => l.startsWith(`Program ${perm} invoke`)).length,
    permissionSuccesses: logs.filter((l) => l === `Program ${perm} success`).length,
  };
}

/**
 * Did the escrow payout happen inside `sig` on the base layer? Returns the
 * escrow's lamport delta in that transaction, or null when the account is not
 * part of it.
 */
async function escrowDeltaIn(
  base: Connection,
  sig: string,
  escrow: PublicKey,
): Promise<{ found: boolean; err: unknown; delta: number | null; invokedProgram: boolean }> {
  const tx = await base.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx?.meta) return { found: false, err: null, delta: null, invokedProgram: false };
  const keys: PublicKey[] = [
    ...tx.transaction.message.staticAccountKeys,
    ...(tx.meta.loadedAddresses?.writable ?? []),
    ...(tx.meta.loadedAddresses?.readonly ?? []),
  ];
  const idx = keys.findIndex((k) => k.equals(escrow));
  const logs = tx.meta.logMessages ?? [];
  return {
    found: true,
    err: tx.meta.err,
    delta: idx >= 0 ? tx.meta.postBalances[idx] - tx.meta.preBalances[idx] : null,
    invokedProgram: logs.some((l) => l.startsWith(`Program ${PROGRAM_ID.toBase58()} invoke`)),
  };
}

/**
 * Wait for a scheduled action to pay the escrow out.
 *
 * Scheduling is not completion, and the committor may land the action in a
 * transaction after the one that undelegates. Poll briefly before concluding the
 * action did not run, otherwise the fallback races it and the result is
 * ambiguous.
 */
async function waitForEscrowPaid(
  program: any,
  escrow: PublicKey,
  timeoutMs = 45_000,
): Promise<{ paid: boolean; waitedMs: number }> {
  const start = Date.now();
  for (;;) {
    const e: any = await program.account.escrow.fetch(escrow);
    if (e.paid) return { paid: true, waitedMs: Date.now() - start };
    if (Date.now() - start >= timeoutMs) return { paid: false, waitedMs: Date.now() - start };
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/**
 * The base transaction in which the escrow lost lamports, i.e. the one that
 * actually paid the job out.
 */
async function findEscrowDebit(
  base: Connection,
  escrow: PublicKey,
): Promise<{ signature: string; delta: number } | null> {
  const sigs = await base.getSignaturesForAddress(escrow, { limit: 20 }, "confirmed");
  for (const s of sigs.slice().reverse()) {
    if (s.err) continue;
    const tx = await base.getTransaction(s.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx?.meta) continue;
    const keys: PublicKey[] = [
      ...tx.transaction.message.staticAccountKeys,
      ...(tx.meta.loadedAddresses?.writable ?? []),
      ...(tx.meta.loadedAddresses?.readonly ?? []),
    ];
    const idx = keys.findIndex((k) => k.equals(escrow));
    if (idx < 0) continue;
    const delta = tx.meta.postBalances[idx] - tx.meta.preBalances[idx];
    if (delta < 0) return { signature: s.signature, delta };
  }
  return null;
}

/**
 * Find a base transaction that touched `escrow` and failed inside
 * `inference_market`. The committor attaches a scheduled action to the same base
 * transaction as the commit; if the action's instruction fails, that whole
 * transaction is rejected, the committor drops the action and retries the commit
 * alone. The failed attempt is the only place the action's error is visible.
 */
async function findFailedActionAttempt(
  base: Connection,
  escrow: PublicKey,
): Promise<{ signature: string; err: unknown; programLogs: string[] } | null> {
  const sigs = await base.getSignaturesForAddress(escrow, { limit: 20 }, "confirmed");
  for (const s of sigs) {
    if (!s.err) continue;
    const tx = await base.getTransaction(s.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const logs = tx?.meta?.logMessages ?? [];
    const mine = logs.filter(
      (l) =>
        l.startsWith("Program log:") ||
        l.startsWith(`Program ${PROGRAM_ID.toBase58()} failed`),
    );
    return { signature: s.signature, err: s.err, programLogs: mine };
  }
  return null;
}

// ---------------------------------------------------------------------------

async function main() {
  step("preflight");
  await assertTeeLive();
  console.log("TEE devnet ER: operational");

  const base = baseConnection();
  const router = routerConnection();
  const validator = await teeIdentity(TEE_URL);
  console.log("TEE validator identity", validator.toBase58());

  const startBalance = await base.getBalance(requester.publicKey);
  console.log("requester", requester.publicKey.toBase58(), "balance", sol(startBalance), "SOL");
  assert.ok(startBalance > 0.6 * LAMPORTS_PER_SOL, "requester balance too low to run");
  console.log("provider", providerKp.publicKey.toBase58());
  console.log("outsider", outsider.publicKey.toBase58());

  step("fund provider + outsider");
  const fund = new Transaction()
    .add(
      SystemProgram.transfer({
        fromPubkey: requester.publicKey,
        toPubkey: providerKp.publicKey,
        lamports: PROVIDER_FUNDING,
      }),
    )
    .add(
      SystemProgram.transfer({
        fromPubkey: requester.publicKey,
        toPubkey: outsider.publicKey,
        lamports: OUTSIDER_FUNDING,
      }),
    );
  const fundSig = await base.sendTransaction(fund, [requester]);
  await base.confirmTransaction(fundSig, "confirmed");
  console.log("funded", sol(PROVIDER_FUNDING), "/", sol(OUTSIDER_FUNDING), "SOL", fundSig);

  step("bind program to base + TEE connections");
  const baseReq = loadProgram(mkProvider(base, requester));
  const baseProv = loadProgram(mkProvider(base, providerKp));
  const teeReqConn = (await authedTeeConnection(TEE_URL, requester.publicKey, signer(requester)))
    .connection;
  const teeProvConn = (
    await authedTeeConnection(TEE_URL, providerKp.publicKey, signer(providerKp))
  ).connection;
  const teeOutConn = (await authedTeeConnection(TEE_URL, outsider.publicKey, signer(outsider)))
    .connection;
  const teeReq = loadProgram(mkProvider(teeReqConn, requester));
  const teeProv = loadProgram(mkProvider(teeProvConn, providerKp));
  const teeOut = loadProgram(mkProvider(teeOutConn, outsider));
  console.log("three TEE auth tokens issued (requester / provider / outsider)");

  step("register provider + top up action escrow");
  const regSig = await registerProvider(baseProv, providerKp.publicKey, "llama3.2:1b");
  console.log("register_provider", regSig);
  const topUpSig = await topUpActionEscrow(base, requester);
  console.log("top_up_ephemeral_balance (index 255)", topUpSig);

  // Bytes never printed; only lengths and hashes.
  const prompt = new TextEncoder().encode("Translate to French: the cat sleeps. ".repeat(40));
  const output = new TextEncoder().encode("Le chat dort. ".repeat(80));
  console.log(
    `payloads: prompt ${prompt.length}B sha256 ${hex(sha256(prompt)).slice(0, 16)}..., ` +
      `output ${output.length}B sha256 ${hex(sha256(output)).slice(0, 16)}...`,
  );

  // =========================================================================
  // Job 1: approve, settled by the scheduled Magic Action (fallback: direct)
  // =========================================================================
  const nonce = BigInt(Date.now());
  step(`job 1 (approve, schedule_action=true) nonce ${nonce}`);
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_SECS;
  const { job, sig: createSig } = await createJob(
    baseReq,
    requester.publicKey,
    nonce,
    PRICE,
    deadline,
    "llama3.2:1b",
  );
  console.log("job", job.toBase58(), "create_job", createSig);

  let fqdn = "";
  try {
    ({ fqdn } = await publishJob(
      { base: baseReq, er: teeReq },
      router,
      requester.publicKey,
      nonce,
      validator,
      prompt,
    ));
  } catch (err) {
    await diagnose("publish job 1", base, teeReqConn, job);
    throw err;
  }
  console.log("delegated to ER fqdn:", fqdn);
  const jobAfterPublish: any = await teeReq.account.job.fetch(job);
  assert.deepEqual(new Uint8Array(jobAfterPublish.promptHash), sha256(prompt));
  assert.ok("open" in jobAfterPublish.status, "job must be Open after finalize_prompt");
  console.log("prompt_hash matches; status Open on ER");

  // Informational: the marketplace discovery query providers would run.
  try {
    const open = await listOpenJobs(teeReq);
    console.log(
      `listOpenJobs on the ER: ${open.length} open, contains this job: ` +
        `${open.some((x) => x.publicKey.equals(job))}`,
    );
  } catch (err) {
    console.log("listOpenJobs on the ER failed (informational):", (err as Error).message);
  }

  step("privacy gating before claim");
  await assert.rejects(readPrivate(teeOut, job), /./, "outsider read must fail");
  console.log("outsider read rejected");
  await assert.rejects(readPrivate(teeProv, job), /./, "provider read before claim must fail");
  console.log("provider read before claim rejected");

  step("claim + read prompt");
  const claimSig = await claimJob(teeProv, providerKp.publicKey, job);
  console.log("claim_job (ER)", claimSig);
  const seen = await readPrivate(teeProv, job);
  assert.equal(Buffer.from(seen.prompt).toString(), Buffer.from(prompt).toString());
  console.log(`provider read ${seen.prompt.length}B prompt, sha256 matches`);
  const claimTx = await txLogs(teeReqConn, claimSig);

  step("submit output");
  const submitSig = await submitOutput(teeProv, providerKp.publicKey, job, output);
  console.log("finalize_output (ER)", submitSig);
  const jobOnEr: any = await teeReq.account.job.fetch(job);
  assert.deepEqual(new Uint8Array(jobOnEr.outputHash), sha256(output));
  const got = await readPrivate(teeReq, job);
  assert.equal(Buffer.from(got.output).toString(), Buffer.from(output).toString());
  console.log(`requester read ${got.output.length}B output, output_hash matches`);
  await assert.rejects(readPrivate(teeOut, job), /./, "outsider read after submit must fail");
  console.log("outsider read after submit still rejected");

  step("approve with post-commit settle action");
  const providerBefore = await base.getBalance(providerKp.publicKey);
  let erSig = "";
  let commitSig = "";
  try {
    ({ erSig, commitSig } = await finishJob(teeReq, requester.publicKey, job, "approve", true));
  } catch (err) {
    await diagnose("approve job 1", base, teeReqConn, job);
    throw err;
  }
  console.log("approve_job (ER)", erSig);
  console.log("commitment (base)", commitSig);
  const finishTx = await txLogs(teeReqConn, erSig);
  await base.confirmTransaction(commitSig, "confirmed");
  try {
    await waitForUndelegation(base, job);
    await waitForUndelegation(base, jobPrivatePda(job));
  } catch (err) {
    await diagnose("undelegate job 1", base, teeReqConn, job);
    throw err;
  }
  console.log("both PDAs undelegated back to inference_market");

  step("private bytes scrubbed on base");
  const jpBase: any = await baseReq.account.jobPrivate.fetch(jobPrivatePda(job));
  assert.equal(jpBase.promptLen, 0);
  assert.equal(jpBase.outputLen, 0);
  assert.ok(new Uint8Array(jpBase.prompt).every((b: number) => b === 0), "prompt not zeroed");
  assert.ok(new Uint8Array(jpBase.output).every((b: number) => b === 0), "output not zeroed");
  console.log("prompt/output zeroed, lengths 0 on base");

  step("settlement");
  const escrowKey = escrowPda(job);
  const commitTx = await escrowDeltaIn(base, commitSig, escrowKey);
  const observed = await waitForEscrowPaid(baseReq, escrowKey);
  let escrow: any = await baseReq.account.escrow.fetch(escrowKey);
  const actionPaid = observed.paid;
  let settlementPath: "magic-action" | "settle_direct-fallback";
  if (actionPaid) {
    // The action settled the escrow. Assert it here, before the fallback could
    // run at all, so a regression back to the fallback fails the run.
    settlementPath = "magic-action";
    assert.equal(escrow.paid, true, "action path must leave the escrow paid");
    console.log(
      `SETTLEMENT PATH: scheduled Magic Action (escrow.paid true after ${observed.waitedMs}ms, ` +
        `no settle_direct sent)`,
    );
  } else {
    settlementPath = "settle_direct-fallback";
    console.log(
      `\n!!! SETTLEMENT PATH: FALLBACK. The scheduled Magic Action did NOT pay out\n` +
        `!!! within ${observed.waitedMs}ms of undelegation. Every approve is settling\n` +
        "!!! through settle_direct. A controller that assumes the action pays will be\n" +
        "!!! wrong. See the PARKED (c) lines below for the failed base transaction and\n" +
        "!!! its inner settle_action error.\n",
    );
    const directSig = await settleDirect(baseProv, providerKp.publicKey, job);
    console.log("settle_direct (base)", directSig);
    escrow = await baseReq.account.escrow.fetch(escrowKey);
  }
  assert.equal(escrow.paid, true, "escrow must be paid");
  const providerAfter = await base.getBalance(providerKp.publicKey);
  assert.ok(
    providerAfter >= providerBefore + PRICE - 10_000,
    `provider balance ${providerAfter} did not grow by the price from ${providerBefore}`,
  );
  console.log(`provider balance ${sol(providerBefore)} -> ${sol(providerAfter)} SOL`);
  const prov: any = await baseReq.account.provider.fetch(providerPda(providerKp.publicKey));
  assert.equal(prov.completed, 1);
  assert.equal(prov.rejected, 0);
  console.log("provider counters: completed 1, rejected 0");
  await assert.rejects(settleDirect(baseProv, providerKp.publicKey, job), /AlreadySettled/);
  console.log("second settle_direct rejected with AlreadySettled");

  // -------------------------------------------------------------------------
  // Parked review items, confirmed on devnet
  // -------------------------------------------------------------------------
  step("parked review items");

  // (a) claim_job: UpdateEphemeralPermissionCpi with authority_is_signer = false.
  const claimOk =
    claimTx !== null && claimTx.err === null && claimTx.permissionSuccesses >= 1;
  console.log(
    `PARKED (a) claim_job permission update (authority_is_signer=false): ${
      claimOk ? "CONFIRMED" : "UNCONFIRMED"
    } - er sig ${claimSig}, err ${JSON.stringify(claimTx?.err ?? "n/a")}, ` +
      `permission-program invokes ${claimTx?.permissionInvokes ?? "n/a"}/` +
      `successes ${claimTx?.permissionSuccesses ?? "n/a"}; provider read of the private ` +
      `record after claim succeeded`,
  );
  assert.ok(claimOk, "claim_job permission update did not succeed");

  // (b) both permission closes in the terminal instruction (duplicate AccountInfo
  //     passed as payer/permissioned_account/authority in each close CPI).
  const jobPermInfo = await teeReqConn.getAccountInfo(permissionPda(job), "confirmed");
  const jpPermInfo = await teeReqConn.getAccountInfo(
    permissionPda(jobPrivatePda(job)),
    "confirmed",
  );
  const closesOk =
    finishTx !== null && finishTx.err === null && finishTx.permissionSuccesses >= 2;
  console.log(
    `PARKED (b) both permission closes (duplicate AccountInfo in close CPI): ${
      closesOk ? "CONFIRMED" : "UNCONFIRMED"
    } - er sig ${erSig}, err ${JSON.stringify(finishTx?.err ?? "n/a")}, ` +
      `permission-program invokes ${finishTx?.permissionInvokes ?? "n/a"}/` +
      `successes ${finishTx?.permissionSuccesses ?? "n/a"}; ER permission accounts now ` +
      `job=${jobPermInfo ? "present" : "absent"} job_private=${jpPermInfo ? "present" : "absent"}`,
  );
  assert.ok(closesOk, "permission closes did not both succeed");

  // (c) did settle_action run in the same base transaction as the undelegation?
  console.log(
    `PARKED (c) settle_action atomic with the commit: ${
      settlementPath === "magic-action" ? "YES (action path)" : "NO (fallback path)"
    } - commitment sig ${commitSig}, tx ${
      commitTx.found ? "found" : "NOT FOUND on base"
    }, err ${JSON.stringify(commitTx.err)}, escrow lamport delta in that tx ${
      commitTx.delta === null ? "escrow not in tx" : commitTx.delta
    }, inference_market invoked in that tx: ${commitTx.invokedProgram}`,
  );
  const debit = await findEscrowDebit(base, escrowKey);
  console.log(
    debit === null
      ? "PARKED (c) no base transaction debited the escrow (unexpected)"
      : `PARKED (c) escrow was debited ${debit.delta} lamports in ${debit.signature}, ` +
          `which is ${
            debit.signature === commitSig
              ? "THE COMMITMENT TRANSACTION ITSELF"
              : "a SEPARATE base transaction from the commitment"
          }`,
  );
  if (settlementPath !== "magic-action") {
    const attempt = await findFailedActionAttempt(base, escrowKey);
    console.log(
      attempt === null
        ? "PARKED (c) no failed base transaction found on the escrow; the action was " +
            "never attempted"
        : `PARKED (c) the action WAS attempted and failed: ${attempt.signature} ` +
            `err ${JSON.stringify(attempt.err)}\n  ` +
            attempt.programLogs.join("\n  "),
    );
  }

  step("close job 1");
  const closeSig = await closeJob(baseReq, requester.publicKey, job);
  console.log("close_job", closeSig);

  // =========================================================================
  // Job 2: reject, no action -> settle_direct
  // =========================================================================
  const nonce2 = nonce + 1n;
  step(`job 2 (reject, schedule_action=false) nonce ${nonce2}`);
  const deadline2 = Math.floor(Date.now() / 1000) + DEADLINE_SECS;
  const { job: job2 } = await createJob(
    baseReq,
    requester.publicKey,
    nonce2,
    PRICE,
    deadline2,
    "llama3.2:1b",
  );
  console.log("job2", job2.toBase58());

  let fqdn2 = "";
  try {
    ({ fqdn: fqdn2 } = await publishJob(
      { base: baseReq, er: teeReq },
      router,
      requester.publicKey,
      nonce2,
      validator,
      prompt,
    ));
  } catch (err) {
    await diagnose("publish job 2", base, teeReqConn, job2);
    throw err;
  }
  console.log("delegated to ER fqdn:", fqdn2);
  assert.equal(fqdn2, fqdn, "both jobs must land on the same ER");

  const claim2 = await claimJob(teeProv, providerKp.publicKey, job2);
  console.log("claim_job (ER)", claim2);
  await submitOutput(teeProv, providerKp.publicKey, job2, output);
  console.log("output submitted");

  const reqBefore = await base.getBalance(requester.publicKey);
  let r2: { erSig: string; commitSig: string };
  try {
    r2 = await finishJob(teeReq, requester.publicKey, job2, "reject", false);
  } catch (err) {
    await diagnose("reject job 2", base, teeReqConn, job2);
    throw err;
  }
  console.log("reject_job (ER)", r2.erSig);
  console.log("commitment (base)", r2.commitSig);
  await base.confirmTransaction(r2.commitSig, "confirmed");
  try {
    await waitForUndelegation(base, job2);
    await waitForUndelegation(base, jobPrivatePda(job2));
  } catch (err) {
    await diagnose("undelegate job 2", base, teeReqConn, job2);
    throw err;
  }
  console.log("both PDAs undelegated");

  const escrow2Before: any = await baseReq.account.escrow.fetch(escrowPda(job2));
  assert.equal(escrow2Before.paid, false, "no action was scheduled, escrow must be unpaid");
  const direct2 = await settleDirect(baseProv, providerKp.publicKey, job2);
  console.log("settle_direct (base)", direct2);
  const e2: any = await baseReq.account.escrow.fetch(escrowPda(job2));
  assert.equal(e2.paid, true);
  const prov2: any = await baseReq.account.provider.fetch(providerPda(providerKp.publicKey));
  assert.equal(prov2.rejected, 1);
  assert.equal(prov2.completed, 1);
  console.log("provider counters: completed 1, rejected 1");
  const reqAfter = await base.getBalance(requester.publicKey);
  assert.ok(
    reqAfter > reqBefore,
    `requester refund not observed: ${reqBefore} -> ${reqAfter}`,
  );
  console.log(`requester balance ${sol(reqBefore)} -> ${sol(reqAfter)} SOL (refund received)`);

  // Reclaim rent so repeated devnet runs stay affordable.
  const close2 = await closeJob(baseReq, requester.publicKey, job2);
  console.log("close_job (job2)", close2);

  const endBalance = await base.getBalance(requester.publicKey);
  console.log(
    `\nrequester balance ${sol(startBalance)} -> ${sol(endBalance)} SOL ` +
      `(run cost ${sol(startBalance - endBalance)} SOL)`,
  );
  console.log("ER fqdn:", fqdn);
  console.log("settlement path (job 1):", settlementPath);
  console.log("E2E OK", { job: job.toBase58(), job2: job2.toBase58() });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
