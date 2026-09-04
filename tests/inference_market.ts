import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import {
  DELEGATION_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.InferenceMarket as anchor.Program;
const wallet = provider.wallet as anchor.Wallet;

const label = (s: string) => { const b = Buffer.alloc(32); b.write(s); return [...b]; };
const u64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };

const providerPda = (w: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("provider"), w.toBuffer()], program.programId)[0];
const jobPda = (r: PublicKey, nonce: bigint) =>
  PublicKey.findProgramAddressSync([Buffer.from("job"), r.toBuffer(), u64le(nonce)], program.programId)[0];
const jobPrivatePda = (job: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("job-private"), job.toBuffer()], program.programId)[0];
const escrowPda = (job: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("escrow"), job.toBuffer()], program.programId)[0];

test("register_provider creates the PDA", async () => {
  await program.methods.registerProvider(label("llama3.2:1b"))
    .accounts({ authority: wallet.publicKey, providerAccount: providerPda(wallet.publicKey), systemProgram: SystemProgram.programId })
    .rpc();
  const acc: any = await program.account.provider.fetch(providerPda(wallet.publicKey));
  assert.equal(acc.authority.toBase58(), wallet.publicKey.toBase58());
  assert.equal(acc.completed, 0);
});

test("create_job funds escrow and pre-funds permission rent", async () => {
  const nonce = 1n;
  const job = jobPda(wallet.publicKey, nonce);
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const price = 0.01 * LAMPORTS_PER_SOL;
  await program.methods.createJob(new anchor.BN(nonce.toString()), new anchor.BN(price), new anchor.BN(deadline), label("llama3.2:1b"))
    .accounts({ requester: wallet.publicKey, job, jobPrivate: jobPrivatePda(job), escrow: escrowPda(job), systemProgram: SystemProgram.programId })
    .rpc();
  const j: any = await program.account.job.fetch(job);
  assert.deepEqual(j.status, { created: {} });
  assert.equal(j.priceLamports.toNumber(), price);
  const e: any = await program.account.escrow.fetch(escrowPda(job));
  assert.equal(e.amount.toNumber(), price);
  assert.equal(e.paid, false);
  const escrowLamports = await provider.connection.getBalance(escrowPda(job));
  assert.ok(escrowLamports >= price);
  const jpInfo = await provider.connection.getAccountInfo(jobPrivatePda(job));
  assert.ok(jpInfo && jpInfo.data.length >= 8 + 32 + 4096 + 5120 + 6);
});

test("create_job rejects zero price and short deadline", async () => {
  const nonce = 2n;
  const job = jobPda(wallet.publicKey, nonce);
  const accounts = { requester: wallet.publicKey, job, jobPrivate: jobPrivatePda(job), escrow: escrowPda(job), systemProgram: SystemProgram.programId };
  await assert.rejects(
    program.methods.createJob(new anchor.BN(2), new anchor.BN(0), new anchor.BN(Math.floor(Date.now()/1000)+3600), label("x")).accounts(accounts).rpc(),
    /ZeroPrice/);
  await assert.rejects(
    program.methods.createJob(new anchor.BN(2), new anchor.BN(1000), new anchor.BN(Math.floor(Date.now()/1000)+10), label("x")).accounts(accounts).rpc(),
    /DeadlineTooSoon/);
});

test("delegate_job and delegate_job_private lock both PDAs under the delegation program", async () => {
  const nonce = 1n;
  const job = jobPda(wallet.publicKey, nonce);
  const jp = jobPrivatePda(job);
  const delAccounts = (acct: PublicKey) => ({
    bufferAcct: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(acct, program.programId),
    record: delegationRecordPdaFromDelegatedAccount(acct),
    meta: delegationMetadataPdaFromDelegatedAccount(acct),
  });
  const dj = delAccounts(job);
  const dp = delAccounts(jp);
  const tx = new anchor.web3.Transaction()
    .add(await program.methods.delegateJob(new anchor.BN(1)).accounts({
      requester: wallet.publicKey, job, validator: null,
      bufferJob: dj.bufferAcct, delegationRecordJob: dj.record, delegationMetadataJob: dj.meta,
      ownerProgram: program.programId, delegationProgram: DELEGATION_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).instruction())
    .add(await program.methods.delegateJobPrivate(new anchor.BN(1)).accounts({
      requester: wallet.publicKey, job, jobPrivate: jp, validator: null,
      bufferJobPrivate: dp.bufferAcct, delegationRecordJobPrivate: dp.record, delegationMetadataJobPrivate: dp.meta,
      ownerProgram: program.programId, delegationProgram: DELEGATION_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).instruction());
  await provider.sendAndConfirm(tx);
  const jobInfo = await provider.connection.getAccountInfo(job);
  const jpInfo = await provider.connection.getAccountInfo(jp);
  assert.equal(jobInfo!.owner.toBase58(), DELEGATION_PROGRAM_ID.toBase58());
  assert.equal(jpInfo!.owner.toBase58(), DELEGATION_PROGRAM_ID.toBase58());
});

test("settle_direct refuses a non-terminal, undelegated job", async () => {
  const nonce = 3n;
  const job = jobPda(wallet.publicKey, nonce);
  await program.methods.createJob(new anchor.BN(3), new anchor.BN(1000), new anchor.BN(Math.floor(Date.now()/1000)+3600), label("x"))
    .accounts({ requester: wallet.publicKey, job, jobPrivate: jobPrivatePda(job), escrow: escrowPda(job), systemProgram: SystemProgram.programId }).rpc();
  await assert.rejects(
    program.methods.settleDirect().accounts({
      payer: wallet.publicKey, jobEscrow: escrowPda(job), job,
      providerAccount: wallet.publicKey, requesterWallet: wallet.publicKey, providerWallet: wallet.publicKey,
    }).rpc(), /NotTerminal/);
});

test("settle_direct refuses a delegated job", async () => {
  const job = jobPda(wallet.publicKey, 1n); // delegated in the earlier test
  await assert.rejects(
    program.methods.settleDirect().accounts({
      payer: wallet.publicKey, jobEscrow: escrowPda(job), job,
      providerAccount: wallet.publicKey, requesterWallet: wallet.publicKey, providerWallet: wallet.publicKey,
    }).rpc(), /JobStillDelegated/);
});

test("base-layer cancel, settle_direct, and close_job settle a never-delegated job", async () => {
  const nonce = 4n;
  const job = jobPda(wallet.publicKey, nonce);
  const jp = jobPrivatePda(job);
  const escrow = escrowPda(job);
  const price = 0.01 * LAMPORTS_PER_SOL;

  await program.methods.createJob(new anchor.BN(nonce.toString()), new anchor.BN(price), new anchor.BN(Math.floor(Date.now()/1000)+3600), label("x"))
    .accounts({ requester: wallet.publicKey, job, jobPrivate: jp, escrow, systemProgram: SystemProgram.programId }).rpc();

  // A job that was never delegated still has a base-layer exit.
  await program.methods.cancelJobBase().accounts({ requester: wallet.publicKey, job }).rpc();
  const cancelled: any = await program.account.job.fetch(job);
  assert.deepEqual(cancelled.status, { cancelled: {} });

  // Terminal but unpaid: close_job must fail on the escrow check specifically.
  const settleAccounts = {
    payer: wallet.publicKey, jobEscrow: escrow, job,
    providerAccount: wallet.publicKey, requesterWallet: wallet.publicKey, providerWallet: wallet.publicKey,
  };
  await assert.rejects(
    program.methods.closeJob().accounts({ requester: wallet.publicKey, job, jobPrivate: jp, jobEscrow: escrow }).rpc(),
    /NotPaid/);

  const before = await provider.connection.getBalance(wallet.publicKey);
  await program.methods.settleDirect().accounts(settleAccounts).rpc();
  const after = await provider.connection.getBalance(wallet.publicKey);
  const e: any = await program.account.escrow.fetch(escrow);
  assert.equal(e.paid, true);
  assert.ok(after - before >= price - 20_000, `expected refund of ~${price}, got ${after - before}`);

  // Escrow.paid is the idempotency key: a second settlement is refused.
  await assert.rejects(program.methods.settleDirect().accounts(settleAccounts).rpc(), /AlreadySettled/);

  await program.methods.closeJob().accounts({ requester: wallet.publicKey, job, jobPrivate: jp, jobEscrow: escrow }).rpc();
  assert.equal(await provider.connection.getAccountInfo(job), null);
  assert.equal(await provider.connection.getAccountInfo(jp), null);
  assert.equal(await provider.connection.getAccountInfo(escrow), null);
});

// ---------------------------------------------------------------------------
// Authorization negatives.
//
// One funded wallet with no relationship to the job, against a freshly created
// job that was never delegated. Every case must be refused by the program's own
// checks, not by a missing account or a CPI that could not run locally.
// ---------------------------------------------------------------------------

const stranger = Keypair.generate();
const strangerNonce = 5n;
const strangerJob = jobPda(wallet.publicKey, strangerNonce);
const strangerJobPrivate = jobPrivatePda(strangerJob);

/** Assert a rejection and put the error that actually came back in the failure. */
const rejectsWith = async (p: Promise<unknown>, re: RegExp, what: string) => {
  await assert.rejects(p, (e: any) => {
    const msg = String(e?.message ?? e);
    assert.match(msg, re, `${what} rejected with an unexpected error: ${msg}`);
    return true;
  });
};

before(async () => {
  await provider.sendAndConfirm(
    new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: stranger.publicKey,
        lamports: 0.05 * LAMPORTS_PER_SOL,
      }),
    ),
  );
  await program.methods
    .createJob(
      new anchor.BN(strangerNonce.toString()),
      new anchor.BN(0.01 * LAMPORTS_PER_SOL),
      new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
      label("x"),
    )
    .accounts({
      requester: wallet.publicKey,
      job: strangerJob,
      jobPrivate: strangerJobPrivate,
      escrow: escrowPda(strangerJob),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
});

test("write_prompt refuses a signer who is not the requester", async () => {
  await rejectsWith(
    program.methods
      .writePrompt(0, Buffer.from("not yours"))
      .accounts({
        requester: stranger.publicKey,
        job: strangerJob,
        jobPrivate: strangerJobPrivate,
        jobPrivatePermission: permissionPdaFromAccount(strangerJobPrivate),
      })
      .signers([stranger])
      .rpc(),
    // ConstraintSeeds, not ConstraintHasOne: `job` is seeded on `requester.key()`,
    // so a stranger's signature cannot even address the requester's job account
    // and the seeds check fires before `has_one` is reached.
    /ConstraintSeeds|2006/,
    "write_prompt by a stranger",
  );
});

test("approve_job refuses a signer who is not the requester", async () => {
  // The handler authorizes before any CPI, so this must fail on Unauthorized
  // rather than on the permission or commit CPIs that a local validator lacks.
  await rejectsWith(
    program.methods
      .approveJob(false)
      .accounts({
        signer: stranger.publicKey,
        job: strangerJob,
        jobPrivate: strangerJobPrivate,
        jobPermission: permissionPdaFromAccount(strangerJob),
        jobPrivatePermission: permissionPdaFromAccount(strangerJobPrivate),
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: EPHEMERAL_VAULT_ID,
        jobEscrow: escrowPda(strangerJob),
        providerAccount: stranger.publicKey,
        requesterWallet: wallet.publicKey,
        providerWallet: wallet.publicKey,
        programId: program.programId,
        magicProgram: MAGIC_PROGRAM_ID,
        magicContext: MAGIC_CONTEXT_ID,
      })
      .signers([stranger])
      .rpc(),
    /Unauthorized/,
    "approve_job by a stranger",
  );
});

test("write_output refuses a signer who did not claim the job", async () => {
  await rejectsWith(
    program.methods
      .writeOutput(0, Buffer.from("not yours"))
      .accounts({
        provider: stranger.publicKey,
        job: strangerJob,
        jobPrivate: strangerJobPrivate,
      })
      .signers([stranger])
      .rpc(),
    /Unauthorized|6001/,
    "write_output by a stranger",
  );
});

test("claim_job refuses a signer with no Provider PDA", async () => {
  await rejectsWith(
    program.methods
      .claimJob()
      .accounts({
        provider: stranger.publicKey,
        providerAccount: providerPda(stranger.publicKey),
        job: strangerJob,
        jobPrivate: strangerJobPrivate,
        jobPrivatePermission: permissionPdaFromAccount(strangerJobPrivate),
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: EPHEMERAL_VAULT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .signers([stranger])
      .rpc(),
    /AccountNotInitialized|3012/,
    "claim_job by a stranger with no Provider PDA",
  );
});
