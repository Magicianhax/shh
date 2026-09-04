import { PublicKey } from "@solana/web3.js";
import {
  permissionPdaFromAccount,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { PROGRAM_ID } from "./constants";

const u64le = (n: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};

export const providerPda = (wallet: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from("provider"), wallet.toBuffer()], PROGRAM_ID)[0];

export const jobPda = (requester: PublicKey, nonce: bigint): PublicKey =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("job"), requester.toBuffer(), u64le(nonce)],
    PROGRAM_ID,
  )[0];

export const jobPrivatePda = (job: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from("job-private"), job.toBuffer()], PROGRAM_ID)[0];

export const escrowPda = (job: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from("escrow"), job.toBuffer()], PROGRAM_ID)[0];

/** ER-local `EphemeralPermission` PDA guarding `account` inside the TEE validator. */
export const permissionPda = (account: PublicKey): PublicKey => permissionPdaFromAccount(account);

/** Delegation-program bookkeeping PDAs required by `delegate_job` / `delegate_job_private`. */
export const delegationAccounts = (
  account: PublicKey,
): { buffer: PublicKey; record: PublicKey; metadata: PublicKey } => ({
  buffer: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(account, PROGRAM_ID),
  record: delegationRecordPdaFromDelegatedAccount(account),
  metadata: delegationMetadataPdaFromDelegatedAccount(account),
});
