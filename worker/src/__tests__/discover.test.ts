import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { MODEL_LABEL_LEN, modelById, priceLamports } from "@inference-market/client";
import { decodeLabel, findClaimable, type Floor } from "../discover";

/** A zero-padded 32-byte label, the way the program stores it. */
const label = (s: string): number[] => {
  const b = Buffer.alloc(MODEL_LABEL_LEN);
  b.write(s);
  return [...b];
};

const key = (n: number) => {
  const b = Buffer.alloc(32);
  b.writeUInt32BE(n, 0);
  return new PublicKey(b);
};

const FAR = Math.floor(Date.now() / 1000) + 3600;

type Row = { publicKey: PublicKey; account: Record<string, unknown> };

const job = (n: number, model: string, price: number, deadline = FAR): Row => ({
  publicKey: key(n),
  account: {
    status: { open: {} },
    modelLabel: label(model),
    priceLamports: price,
    deadlineUnix: deadline,
  },
});

/**
 * `findClaimable` reaches the rollup only through `listOpenJobs`, which calls
 * `program.account.job.all` with a status filter. Standing in for the program
 * keeps the test on the matching logic.
 */
const fakeEr = (rows: Row[]) => ({
  account: { job: { all: async () => rows } },
  programId: PublicKey.default,
});

const opus = modelById("claude-opus-5")!;
const fable = modelById("claude-fable-5-1")!;

const served: ReadonlyMap<string, Floor> = new Map<string, Floor>([
  [opus.id, { floorLamports: priceLamports(opus) }],
  [fable.id, { floorLamports: priceLamports(fable) }],
]);

test("decodeLabel strips the zero padding", () => {
  assert.equal(decodeLabel(label("claude-opus-5")), "claude-opus-5");
  assert.equal(decodeLabel(label("")), "");
  // A 32-byte id fills the array with no NUL to stop at.
  const full = "x".repeat(MODEL_LABEL_LEN);
  assert.equal(decodeLabel(label(full)), full);
});

test("claims a served model priced at its floor, skips underpriced and unknown", async () => {
  const rows = [
    job(1, opus.id, priceLamports(opus)), // exactly at the floor: claimable
    job(2, fable.id, priceLamports(fable) + 1), // over the floor: claimable
    job(3, opus.id, priceLamports(opus) - 1), // a lamport short: skipped
    job(4, "gpt-5.6-terra", 999_000_000), // another provider's model: not ours
    job(5, "some-other-label", 999_000_000), // not in the catalog at all
  ];

  const { jobs, skippedUnderpriced } = await findClaimable(fakeEr(rows), served, 30);

  assert.deepEqual(
    jobs.map((j) => j.job.toBase58()),
    [key(1).toBase58(), key(2).toBase58()],
  );
  assert.deepEqual(
    jobs.map((j) => j.modelId),
    [opus.id, fable.id],
  );
  assert.equal(skippedUnderpriced, 1, "only the served-but-cheap job counts as underpriced");
});

test("an unserved model is never counted as underpriced", async () => {
  const rows = [job(1, "gpt-5.6-luna", 1)];
  const { jobs, skippedUnderpriced } = await findClaimable(fakeEr(rows), served, 30);
  assert.deepEqual(jobs, []);
  assert.equal(skippedUnderpriced, 0);
});

test("a job too close to its deadline is not claimed", async () => {
  const soon = Math.floor(Date.now() / 1000) + 10;
  const rows = [job(1, opus.id, priceLamports(opus), soon)];
  const { jobs } = await findClaimable(fakeEr(rows), served, 30);
  assert.deepEqual(jobs, []);
});

test("a floor multiplier above 1 rejects a job priced at the catalog rate", async () => {
  const strict: ReadonlyMap<string, Floor> = new Map([
    [opus.id, { floorLamports: Math.ceil(priceLamports(opus) * 1.5) }],
  ]);
  const rows = [job(1, opus.id, priceLamports(opus))];
  const { jobs, skippedUnderpriced } = await findClaimable(fakeEr(rows), strict, 30);
  assert.deepEqual(jobs, []);
  assert.equal(skippedUnderpriced, 1);
});
