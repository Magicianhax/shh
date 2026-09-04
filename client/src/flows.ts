import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
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

export async function createJob(
  base: AnyProgram,
  requester: PublicKey,
  nonce: bigint,
  priceLamports: number,
  deadlineUnix: number,
  model: string,
): Promise<{ job: PublicKey; sig: string }> {
  const job = jobPda(requester, nonce);
  const sig = await base.methods
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
    .rpc();
  return { job, sig };
}

/** Delegate `Job` and `JobPrivate` to `validator` in one base-layer transaction. */
export async function delegateJob(
  base: AnyProgram,
  requester: PublicKey,
  nonce: bigint,
  validator: PublicKey,
): Promise<string> {
  const job = jobPda(requester, nonce);
  const jp = jobPrivatePda(job);
  const dj = delegationAccounts(job);
  const dp = delegationAccounts(jp);
  const common = {
    ownerProgram: PROGRAM_ID,
    delegationProgram: DELEGATION_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };
  const tx = new Transaction()
    .add(
      await base.methods
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
    )
    .add(
      await base.methods
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
    );
  return (base.provider as anchor.AnchorProvider).sendAndConfirm(tx);
}

// ---------------------------------------------------------------------------
// Ephemeral rollup
// ---------------------------------------------------------------------------

/** Accounts shared by `init_permissions` and the four terminal instructions. */
const permAccounts = (job: PublicKey) => ({
  jobPermission: permissionPda(job),
  jobPrivatePermission: permissionPda(jobPrivatePda(job)),
  permissionProgram: PERMISSION_PROGRAM_ID,
  ephemeralVault: EPHEMERAL_VAULT_ID,
  magicProgram: MAGIC_PROGRAM_ID,
});

/**
 * Delegate both PDAs, wait for the router to place them on one ER, create the
 * ER-local permissions, then stream the prompt in and seal it.
 *
 * `skipPreflight: true` on every ER call: the TEE endpoint requires the auth
 * token on simulation as well as send, and Anchor 0.32.1 does not forward the
 * custom query string on its simulate path. On failure, inspect the executed
 * transaction with
 * `er.provider.connection.getTransaction(sig, { commitment: "confirmed" })`.
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
  const jpPermission = permissionPda(jp);

  await delegateJob(p.base, requester, nonce, validator);
  const fqdn = await waitForDelegation(router, [job, jp]);

  await p.er.methods
    .initPermissions()
    .accounts({ requester, job, jobPrivate: jp, ...permAccounts(job) })
    .rpc({ skipPreflight: true });

  for (const c of chunk(prompt)) {
    await p.er.methods
      .writePrompt(c.offset, Buffer.from(c.data))
      .accounts({ requester, job, jobPrivate: jp, jobPrivatePermission: jpPermission })
      .rpc({ skipPreflight: true });
  }

  await p.er.methods
    .finalizePrompt(prompt.length)
    .accounts({ requester, job, jobPrivate: jp, jobPrivatePermission: jpPermission })
    .rpc({ skipPreflight: true });

  return { job, fqdn };
}

export async function claimJob(
  er: AnyProgram,
  provider: PublicKey,
  job: PublicKey,
): Promise<string> {
  const jp = jobPrivatePda(job);
  return er.methods
    .claimJob()
    .accounts({
      provider,
      providerAccount: providerPda(provider),
      job,
      jobPrivate: jp,
      jobPrivatePermission: permissionPda(jp),
      permissionProgram: PERMISSION_PROGRAM_ID,
      ephemeralVault: EPHEMERAL_VAULT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .rpc({ skipPreflight: true });
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
    await er.methods
      .writeOutput(c.offset, Buffer.from(c.data))
      .accounts({ provider, job, jobPrivate: jp })
      .rpc({ skipPreflight: true });
  }
  return er.methods
    .finalizeOutput(output.length)
    .accounts({ provider, job, jobPrivate: jp })
    .rpc({ skipPreflight: true });
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
  const sig: string = await m(scheduleAction).accounts(accounts).rpc({ skipPreflight: true });
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
  lamports = 0.01 * LAMPORTS_PER_SOL,
): Promise<string> {
  const escrow = escrowPdaFromEscrowAuthority(payer.publicKey, ACTION_ESCROW_INDEX);
  const ix = createTopUpEscrowInstruction(
    escrow,
    payer.publicKey,
    payer.publicKey,
    lamports,
    ACTION_ESCROW_INDEX,
  );
  const tx = new Transaction().add(ix);
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
