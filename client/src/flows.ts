import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ConnectionMagicRouter,
  DELEGATION_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
  GetCommitmentSignature,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  createTopUpEscrowInstruction,
  escrowPdaFromEscrowAuthority,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { chunk } from "./chunks";
import {
  ACTION_ESCROW_INDEX,
  MODEL_LABEL_LEN,
  OUTPUT_MAX,
  PROGRAM_ID,
  PROMPT_MAX,
} from "./constants";
import {
  delegationAccounts,
  escrowPda,
  jobPda,
  jobPrivatePda,
  permissionPda,
  providerPda,
} from "./pda";
import { waitForDelegation } from "./connections";
import type { AnyProgram } from "./program";

/**
 * The same program bound to two providers: `base` on Solana devnet, `er` on the
 * TEE ephemeral rollup that holds the delegated `Job` / `JobPrivate` accounts.
 */
export type Programs = { base: AnyProgram; er: AnyProgram };

/** Right-pad a model name into the fixed `[u8; 32]` label the program stores. */
export const label32 = (s: string): number[] => {
  const b = Buffer.alloc(MODEL_LABEL_LEN);
  b.write(s.slice(0, MODEL_LABEL_LEN));
  return [...b];
};

// ---------------------------------------------------------------------------
// Base layer
// ---------------------------------------------------------------------------

export async function registerProvider(
  base: AnyProgram,
  authority: PublicKey,
  model: string,
): Promise<string> {
  return base.methods
    .registerProvider(label32(model))
    .accounts({
      authority,
      providerAccount: providerPda(authority),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

/** Default ephemeral-balance top-up for scheduled Magic Actions, in lamports. */
export const ACTION_TOP_UP_LAMPORTS = 0.01 * LAMPORTS_PER_SOL;

/** Hard packet limit for a Solana transaction. */
export const TX_SIZE_LIMIT = 1232;

/** Length of a compact-u16 count, the prefix web3.js writes before the signatures. */
const shortVecLen = (n: number): number => (n < 0x80 ? 1 : n < 0x4000 ? 2 : 3);

/**
 * Wire size of an unsigned transaction, signature placeholders included.
 * A transaction over `TX_SIZE_LIMIT` bytes is rejected before it is ever sent.
 *
 * This is the same number `tx.serialize({ requireAllSignatures: false }).length`
 * reports, computed the long way because `serialize` throws "Transaction too
 * large" rather than returning a size — and an oversized candidate is exactly
 * what `packInstructions` has to be able to measure and reject.
 */
export const packedSize = (tx: Transaction): number => {
  const message = tx.serializeMessage();
  const sigs = tx.signatures.length;
  return shortVecLen(sigs) + sigs * 64 + message.length;
};

/**
 * Greedily pack `ixs` into as few transactions as fit, preserving order.
 *
 * Order is load-bearing here: `create_job` must execute before either delegate
 * instruction, so the pack never reorders and the caller sends the results in
 * sequence.
 */
export function packInstructions(
  ixs: TransactionInstruction[],
  feePayer: PublicKey,
  blockhash: string,
): Transaction[] {
  const build = (group: TransactionInstruction[]) => {
    const tx = new Transaction();
    for (const ix of group) tx.add(ix);
    tx.feePayer = feePayer;
    tx.recentBlockhash = blockhash;
    return tx;
  };

  const out: Transaction[] = [];
  let group: TransactionInstruction[] = [];
  for (const ix of ixs) {
    if (group.length > 0 && packedSize(build([...group, ix])) > TX_SIZE_LIMIT) {
      out.push(build(group));
      group = [];
    }
    group.push(ix);
  }
  if (group.length > 0) out.push(build(group));
  return out;
}

export async function createJobIx(
  base: AnyProgram,
  requester: PublicKey,
  nonce: bigint,
  priceLamports: number,
  deadlineUnix: number,
  model: string,
): Promise<TransactionInstruction> {
  const job = jobPda(requester, nonce);
  return base.methods
    .createJob(
      new anchor.BN(nonce.toString()),
      new anchor.BN(priceLamports),
      new anchor.BN(deadlineUnix),
      label32(model),
    )
    .accounts({
      requester,
      job,
      jobPrivate: jobPrivatePda(job),
      escrow: escrowPda(job),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

/** The two instructions that hand `Job` and `JobPrivate` to `validator`. */
export async function delegateJobIxs(
  base: AnyProgram,
  requester: PublicKey,
  nonce: bigint,
  validator: PublicKey,
): Promise<TransactionInstruction[]> {
  const job = jobPda(requester, nonce);
  const jp = jobPrivatePda(job);
  const dj = delegationAccounts(job);
  const dp = delegationAccounts(jp);
  const common = {
    ownerProgram: PROGRAM_ID,
    delegationProgram: DELEGATION_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };
  return Promise.all([
    base.methods
      .delegateJob(new anchor.BN(nonce.toString()))
      .accounts({
        requester,
        job,
        validator,
        bufferJob: dj.buffer,
        delegationRecordJob: dj.record,
        delegationMetadataJob: dj.metadata,
        ...common,
      })
      .instruction(),
    base.methods
      .delegateJobPrivate(new anchor.BN(nonce.toString()))
      .accounts({
        requester,
        job,
        jobPrivate: jp,
        validator,
        bufferJobPrivate: dp.buffer,
        delegationRecordJobPrivate: dp.record,
        delegationMetadataJobPrivate: dp.metadata,
        ...common,
      })
      .instruction(),
  ]);
}

/**
 * Fund `payer`'s delegation-program ephemeral balance at `ACTION_ESCROW_INDEX`,
 * the escrow a scheduled `settle_action` is charged to. Sent on the base layer.
 */
export const topUpActionEscrowIx = (
  payer: PublicKey,
  lamports = ACTION_TOP_UP_LAMPORTS,
): TransactionInstruction =>
  createTopUpEscrowInstruction(
    escrowPdaFromEscrowAuthority(payer, ACTION_ESCROW_INDEX),
    payer,
    payer,
    lamports,
    ACTION_ESCROW_INDEX,
  );

export async function createJob(
  base: AnyProgram,
  requester: PublicKey,
  nonce: bigint,
  priceLamports: number,
  deadlineUnix: number,
  model: string,
): Promise<{ job: PublicKey; sig: string }> {
  const sig = await (base.provider as anchor.AnchorProvider).sendAndConfirm(
    new Transaction().add(
      await createJobIx(base, requester, nonce, priceLamports, deadlineUnix, model),
    ),
  );
  return { job: jobPda(requester, nonce), sig };
}

/** Delegate `Job` and `JobPrivate` to `validator` in one base-layer transaction. */
export async function delegateJob(
  base: AnyProgram,
  requester: PublicKey,
  nonce: bigint,
  validator: PublicKey,
): Promise<string> {
  const tx = new Transaction();
  for (const ix of await delegateJobIxs(base, requester, nonce, validator)) tx.add(ix);
  return (base.provider as anchor.AnchorProvider).sendAndConfirm(tx);
}

export type OpenJobPlan = {
  job: PublicKey;
  txs: Transaction[];
  /** Packed byte size of each transaction, in order. */
  sizes: number[];
};

/**
 * Everything a message needs on the base layer, packed for one wallet approval:
 * `create_job`, both delegate instructions, and — when `topUpLamports > 0` — the
 * ephemeral-balance top-up that lets the eventual approval schedule its own
 * payout.
 *
 * The result is normally a single transaction. If the four instructions ever
 * exceed `TX_SIZE_LIMIT` the plan splits, in order; the caller must sign the
 * whole plan in one `signAllTransactions` call so the split still costs one
 * approval, and send the parts in sequence because `create_job` must land first.
 */
export async function buildOpenJobTxs(
  base: AnyProgram,
  requester: PublicKey,
  nonce: bigint,
  priceLamports: number,
  deadlineUnix: number,
  model: string,
  validator: PublicKey,
  topUpLamports = 0,
): Promise<OpenJobPlan> {
  const ixs: TransactionInstruction[] = [
    await createJobIx(base, requester, nonce, priceLamports, deadlineUnix, model),
    ...(await delegateJobIxs(base, requester, nonce, validator)),
  ];
  if (topUpLamports > 0) ixs.push(topUpActionEscrowIx(requester, topUpLamports));

  const conn = base.provider.connection;
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const txs = packInstructions(ixs, requester, blockhash);
  return { job: jobPda(requester, nonce), txs, sizes: txs.map(packedSize) };
}

/**
 * Build and send the base-layer half of a message.
 *
 * `AnchorProvider.sendAll` signs the whole plan with a single
 * `signAllTransactions` call and then sends and confirms each transaction in
 * turn, so a one-transaction plan is one wallet prompt and a split plan is still
 * one wallet prompt.
 */
export async function openJob(
  base: AnyProgram,
  requester: PublicKey,
  nonce: bigint,
  priceLamports: number,
  deadlineUnix: number,
  model: string,
  validator: PublicKey,
  topUpLamports = 0,
): Promise<{ job: PublicKey; sigs: string[]; sizes: number[] }> {
  const plan = await buildOpenJobTxs(
    base,
    requester,
    nonce,
    priceLamports,
    deadlineUnix,
    model,
    validator,
    topUpLamports,
  );
  const sigs = await (base.provider as anchor.AnchorProvider).sendAll(
    plan.txs.map((tx) => ({ tx })),
  );
  return { job: plan.job, sigs, sizes: plan.sizes };
}

// ---------------------------------------------------------------------------
// Ephemeral rollup
// ---------------------------------------------------------------------------

/**
 * Send an ER instruction and surface the real on-chain failure.
 *
 * Anchor 0.32.1 rebuilds a failed transaction's error with the pre-1.95
 * two-argument `new SendTransactionError(message, logs)` form, while
 * `@solana/web3.js` 1.98 expects a single options object. The mismatch turns
 * every failed ER transaction into the useless `Unknown action 'undefined'`
 * and drops the signature, the runtime error and the logs on the floor. Sending
 * the transaction here keeps all three.
 *
 * `skipPreflight: true` is deliberate: the TEE endpoint requires the auth token
 * on simulation as well as send, and Anchor does not forward the custom query
 * string on its simulate path.
 */
type Blockhash = Awaited<ReturnType<Connection["getLatestBlockhash"]>>;

/** Confirm one ER signature, surfacing the runtime error and the program logs. */
async function erConfirm(conn: Connection, sig: string, bh: Blockhash): Promise<string> {
  const res = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  if (res.value.err) {
    const failed = await conn.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const logs = failed?.meta?.logMessages ?? [];
    throw new Error(
      `ER transaction ${sig} failed: ${JSON.stringify(res.value.err)}\n` +
        `logs:\n  ${logs.join("\n  ")}`,
    );
  }
  return sig;
}

async function erRpc(er: AnyProgram, builder: any): Promise<string> {
  const provider = er.provider as anchor.AnchorProvider;
  const conn = provider.connection;
  const tx: Transaction = await builder.transaction();
  tx.feePayer = provider.wallet.publicKey;
  const bh = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = bh.blockhash;
  const signed = await provider.wallet.signTransaction(tx);
  const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: true });
  return erConfirm(conn, sig, bh);
}

/** Which signing path a rollup sequence took. */
export type ErSignMode = "batched" | "sequential";

/**
 * Run an ordered sequence of ER instructions for one wallet approval.
 *
 * Every transaction shares one blockhash and they are signed together with
 * `signAllTransactions`, which Phantom and Solflare both implement, so a whole
 * prompt costs a single prompt from the wallet. They are still **sent** one at a
 * time and each is confirmed before the next: the sequence is a dependency
 * chain, not a batch. The permission must exist before the first write, and
 * `finalize_prompt` must follow every chunk.
 *
 * A wallet without `signAllTransactions` falls back to the original path, one
 * sign-send-confirm per instruction, and reports `"sequential"` so the caller
 * can say which path ran.
 */
async function erSendAll(
  er: AnyProgram,
  builders: any[],
): Promise<{ sigs: string[]; mode: ErSignMode }> {
  const provider = er.provider as anchor.AnchorProvider;
  const conn = provider.connection;
  // `provider.wallet` is typed as always having `signAllTransactions`, but the
  // adapter behind it is whatever the user connected, so this is a real check.
  const wallet = provider.wallet;

  if (typeof wallet.signAllTransactions !== "function") {
    const sigs: string[] = [];
    for (const b of builders) sigs.push(await erRpc(er, b));
    return { sigs, mode: "sequential" };
  }

  const bh = await conn.getLatestBlockhash("confirmed");
  const txs: Transaction[] = [];
  for (const b of builders) {
    const tx: Transaction = await b.transaction();
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = bh.blockhash;
    txs.push(tx);
  }

  const signed = await wallet.signAllTransactions(txs);
  const sigs: string[] = [];
  for (const tx of signed) {
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    sigs.push(await erConfirm(conn, sig, bh));
  }
  return { sigs, mode: "batched" };
}

/** Accounts shared by `init_permissions` and the four terminal instructions. */
const permAccounts = (job: PublicKey) => ({
  jobPermission: permissionPda(job),
  jobPrivatePermission: permissionPda(jobPrivatePda(job)),
  permissionProgram: PERMISSION_PROGRAM_ID,
  ephemeralVault: EPHEMERAL_VAULT_ID,
  magicProgram: MAGIC_PROGRAM_ID,
});

/**
 * Open the ER-local permissions, stream the prompt in, and seal it.
 *
 * The whole sequence is one wallet approval on a wallet that implements
 * `signAllTransactions`; see `erSendAll` for the ordering guarantee and the
 * fallback. The job and its private buffer must already be delegated and
 * observed on a single ER.
 *
 * Callers must not log `prompt` or any of its chunks.
 */
export async function sealPrompt(
  er: AnyProgram,
  requester: PublicKey,
  job: PublicKey,
  prompt: Uint8Array,
): Promise<{ sigs: string[]; mode: ErSignMode }> {
  if (prompt.length === 0 || prompt.length > PROMPT_MAX) {
    throw new Error(`prompt length must be 1..=${PROMPT_MAX}, got ${prompt.length}`);
  }
  const jp = jobPrivatePda(job);
  const jpPermission = permissionPda(jp);
  const priv = { requester, job, jobPrivate: jp, jobPrivatePermission: jpPermission };

  return erSendAll(er, [
    er.methods
      .initPermissions()
      .accounts({ requester, job, jobPrivate: jp, ...permAccounts(job) }),
    ...chunk(prompt).map((c) =>
      er.methods.writePrompt(c.offset, Buffer.from(c.data)).accounts(priv),
    ),
    er.methods.finalizePrompt(prompt.length).accounts(priv),
  ]);
}

/**
 * Delegate both PDAs, wait for the router to place them on one ER, create the
 * ER-local permissions, then stream the prompt in and seal it.
 *
 * Kept as the one-call path for scripts. The app splits it so the base-layer
 * half can be packed together with `create_job`; see `openJob` and `sealPrompt`.
 */
export async function publishJob(
  p: Programs,
  router: ConnectionMagicRouter,
  requester: PublicKey,
  nonce: bigint,
  validator: PublicKey,
  prompt: Uint8Array,
): Promise<{ job: PublicKey; fqdn: string }> {
  if (prompt.length === 0 || prompt.length > PROMPT_MAX) {
    throw new Error(`prompt length must be 1..=${PROMPT_MAX}, got ${prompt.length}`);
  }
  const job = jobPda(requester, nonce);
  const jp = jobPrivatePda(job);

  await delegateJob(p.base, requester, nonce, validator);
  const fqdn = await waitForDelegation(router, [job, jp]);
  await sealPrompt(p.er, requester, job, prompt);

  return { job, fqdn };
}

export async function claimJob(
  er: AnyProgram,
  provider: PublicKey,
  job: PublicKey,
): Promise<string> {
  const jp = jobPrivatePda(job);
  return erRpc(
    er,
    er.methods.claimJob().accounts({
      provider,
      providerAccount: providerPda(provider),
      job,
      jobPrivate: jp,
      jobPrivatePermission: permissionPda(jp),
      permissionProgram: PERMISSION_PROGRAM_ID,
      ephemeralVault: EPHEMERAL_VAULT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    }),
  );
}

/**
 * Read the private buffers from the ER. Requires an ER connection authenticated
 * as a key the `JobPrivate` permission lists; otherwise the read is rejected.
 * Callers must not log the returned bytes.
 */
export async function readPrivate(
  er: AnyProgram,
  job: PublicKey,
): Promise<{ prompt: Uint8Array; output: Uint8Array }> {
  const jp: any = await er.account.jobPrivate.fetch(jobPrivatePda(job));
  const prompt = new Uint8Array(jp.prompt).subarray(0, jp.promptLen);
  const output = new Uint8Array(jp.output).subarray(0, jp.outputLen);
  return { prompt, output };
}

export async function readPrompt(
  er: AnyProgram,
  job: PublicKey,
): Promise<Uint8Array> {
  return (await readPrivate(er, job)).prompt;
}

export async function readOutput(
  er: AnyProgram,
  job: PublicKey,
): Promise<Uint8Array> {
  return (await readPrivate(er, job)).output;
}

export async function submitOutput(
  er: AnyProgram,
  provider: PublicKey,
  job: PublicKey,
  output: Uint8Array,
): Promise<string> {
  if (output.length === 0 || output.length > OUTPUT_MAX) {
    throw new Error(`output length must be 1..=${OUTPUT_MAX}, got ${output.length}`);
  }
  const jp = jobPrivatePda(job);
  for (const c of chunk(output)) {
    await erRpc(
      er,
      er.methods
        .writeOutput(c.offset, Buffer.from(c.data))
        .accounts({ provider, job, jobPrivate: jp }),
    );
  }
  return erRpc(
    er,
    er.methods.finalizeOutput(output.length).accounts({ provider, job, jobPrivate: jp }),
  );
}

export type FinishKind = "approve" | "reject" | "cancel" | "expire";

/**
 * Move a job to a terminal state on the ER. This scrubs the private buffers,
 * closes both ER permissions, and commits-and-undelegates `Job` and
 * `JobPrivate` back to the base layer.
 *
 * `scheduleAction` attaches a post-commit `settle_action` that pays out the
 * escrow atomically with the commit. It is charged to the signer's
 * ephemeral-balance escrow at index `ACTION_ESCROW_INDEX`, so the signer must
 * have called `topUpActionEscrow` first. An `expire` caller without a funded
 * action escrow must pass `scheduleAction = false` and settle afterwards with
 * `settleDirect` on the base layer once undelegation lands.
 *
 * Scheduling is not completion: always reconcile the payout by reading the
 * escrow, and fall back to `settleDirect` if the action did not run.
 */
export async function finishJob(
  er: AnyProgram,
  signer: PublicKey,
  job: PublicKey,
  kind: FinishKind,
  scheduleAction: boolean,
  /**
   * Called with the rollup signature the moment the decision is accepted, before
   * the commitment signature is looked up. The lookup can fail on a decision
   * that already landed, and a caller that only sees the throw cannot tell the
   * two apart; this callback is how it learns the decision is on chain.
   */
  onErSignature?: (sig: string) => void,
): Promise<{ erSig: string; commitSig: string }> {
  const j: any = await er.account.job.fetch(job);
  const claimed = !j.provider.equals(PublicKey.default);
  const accounts = {
    signer,
    job,
    jobPrivate: jobPrivatePda(job),
    ...permAccounts(job),
    jobEscrow: escrowPda(job),
    providerAccount: claimed ? providerPda(j.provider) : j.requester,
    requesterWallet: j.requester,
    providerWallet: claimed ? j.provider : j.requester,
    programId: PROGRAM_ID,
    magicContext: MAGIC_CONTEXT_ID,
  };
  const m = {
    approve: er.methods.approveJob,
    reject: er.methods.rejectJob,
    cancel: er.methods.cancelJob,
    expire: er.methods.expireJob,
  }[kind];
  const sig: string = await erRpc(er, m(scheduleAction).accounts(accounts));
  onErSignature?.(sig);
  const commitSig = await GetCommitmentSignature(sig, er.provider.connection);
  return { erSig: sig, commitSig };
}

// ---------------------------------------------------------------------------
// Base layer settlement / cleanup
// ---------------------------------------------------------------------------

/**
 * Permissionless escrow payout for a terminal, undelegated job. Use this when
 * no `settle_action` was scheduled, or when the scheduled one did not run.
 */
export async function settleDirect(
  base: AnyProgram,
  payer: PublicKey,
  job: PublicKey,
): Promise<string> {
  const j: any = await base.account.job.fetch(job);
  const claimed = !j.provider.equals(PublicKey.default);
  return base.methods
    .settleDirect()
    .accounts({
      payer,
      jobEscrow: escrowPda(job),
      job,
      providerAccount: claimed ? providerPda(j.provider) : j.requester,
      requesterWallet: j.requester,
      providerWallet: claimed ? j.provider : j.requester,
    })
    .rpc();
}

/** Cancel a job that is still on the base layer, before it was ever delegated. */
export async function cancelJobBase(
  base: AnyProgram,
  requester: PublicKey,
  job: PublicKey,
): Promise<string> {
  return base.methods.cancelJobBase().accounts({ requester, job }).rpc();
}

/** Reclaim rent from a settled job by closing `Job`, `JobPrivate` and the escrow. */
export async function closeJob(
  base: AnyProgram,
  requester: PublicKey,
  job: PublicKey,
): Promise<string> {
  return base.methods
    .closeJob()
    .accounts({
      requester,
      job,
      jobPrivate: jobPrivatePda(job),
      jobEscrow: escrowPda(job),
    })
    .rpc();
}

/**
 * Fund the delegation-program ephemeral balance that pays for scheduled Magic
 * Actions. Sent on the BASE layer, at `ACTION_ESCROW_INDEX` so the on-chain
 * `settle_action` signer check matches.
 */
export async function topUpActionEscrow(
  base: Connection,
  payer: Keypair,
  lamports = ACTION_TOP_UP_LAMPORTS,
): Promise<string> {
  const tx = new Transaction().add(topUpActionEscrowIx(payer.publicKey, lamports));
  tx.feePayer = payer.publicKey;
  const sig = await base.sendTransaction(tx, [payer]);
  await base.confirmTransaction(sig, "confirmed");
  return sig;
}

/** Every `Job` currently in the `Open` state, as seen by the given program binding. */
export async function listOpenJobs(
  program: AnyProgram,
): Promise<{ publicKey: PublicKey; account: any }[]> {
  const all = await program.account.job.all();
  return all.filter((x: any) => "open" in x.account.status);
}
