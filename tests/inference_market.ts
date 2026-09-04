import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";

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
