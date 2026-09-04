import { test } from "node:test";
import assert from "node:assert/strict";
import { chunk } from "../chunks";
import { sha256 } from "../hash";
import { jobPda, jobPrivatePda, escrowPda } from "../pda";
import { PublicKey } from "@solana/web3.js";

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
