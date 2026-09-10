import { test } from "node:test";
import assert from "node:assert/strict";
import { chunk } from "../chunks";
import { sha256 } from "../hash";
import { jobPda, jobPrivatePda, escrowPda } from "../pda";
import { packInstructions, packedSize, TX_SIZE_LIMIT } from "../flows";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

test("chunk splits at CHUNK_MAX with offsets", () => {
  const bytes = new Uint8Array(2000).fill(7);
  const parts = chunk(bytes, 900);
  assert.equal(parts.length, 3);
  assert.deepEqual(
    parts.map((p) => p.offset),
    [0, 900, 1800],
  );
  assert.equal(parts[2]!.data.length, 200);
});

test("sha256 matches known vector", () => {
  const h = sha256(new TextEncoder().encode("abc"));
  assert.equal(Buffer.from(h.slice(0, 4)).toString("hex"), "ba7816bf");
});

test("pdas derive deterministically", () => {
  const r = new PublicKey("11111111111111111111111111111112");
  const job = jobPda(r, 1n);
  assert.ok(jobPrivatePda(job).equals(jobPrivatePda(job)));
  assert.ok(!escrowPda(job).equals(jobPrivatePda(job)));
});

// Any 32-byte base58 string is a well-formed blockhash, and every blockhash is
// the same size on the wire, so packing can be measured without an RPC.
const BLOCKHASH = "11111111111111111111111111111111";

const transfer = (from: PublicKey) =>
  SystemProgram.transfer({
    fromPubkey: from,
    toPubkey: Keypair.generate().publicKey,
    lamports: 1,
  });

test("packInstructions keeps a small batch in one transaction", () => {
  const payer = Keypair.generate().publicKey;
  const ixs = [transfer(payer), transfer(payer), transfer(payer), transfer(payer)];
  const txs = packInstructions(ixs, payer, BLOCKHASH);
  assert.equal(txs.length, 1);
  assert.equal(txs[0]!.instructions.length, 4);
  assert.ok(packedSize(txs[0]!) <= TX_SIZE_LIMIT);
});

test("packInstructions splits over the size limit, in order", () => {
  const payer = Keypair.generate().publicKey;
  const ixs = Array.from({ length: 40 }, () => transfer(payer));
  const txs = packInstructions(ixs, payer, BLOCKHASH);

  assert.ok(txs.length > 1, "40 transfers must not fit one packet");
  for (const tx of txs) assert.ok(packedSize(tx) <= TX_SIZE_LIMIT);

  // Order is load-bearing: create_job has to execute before the delegates.
  const flat = txs.flatMap((tx) => tx.instructions);
  assert.equal(flat.length, ixs.length);
  flat.forEach((ix, i) => assert.deepEqual(ix.keys, ixs[i]!.keys));
});
