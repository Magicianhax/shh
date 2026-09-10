import { test } from "node:test";
import assert from "node:assert/strict";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { BlockhashExpiredError, signSendWithFreshHash } from "../flows";

/**
 * The wallet is slower than a blockhash and nothing here can change that, so
 * the behaviour that matters is what happens when it loses the race. These pin
 * it without a wallet, a network, or sixty seconds of waiting.
 */

const payer = Keypair.generate().publicKey;

type Script = {
  /** One entry per send attempt: what `sendRawTransaction` does that time. */
  sends: ("ok" | "notFound")[];
  /** Block height reported after each failure, against a lastValidBlockHeight of 150. */
  height: number;
};

/**
 * A connection that answers only what these paths ask of it. `getBlockHeight`
 * is the oracle the code uses to tell a dead hash from a merely unlucky one,
 * so it is the single knob these tests turn.
 */
function fakeConnection(script: Script) {
  let sendCall = 0;
  const calls = { blockhash: 0, send: 0, confirm: 0 };
  const conn = {
    async getLatestBlockhash() {
      calls.blockhash++;
      return { blockhash: `hash${calls.blockhash}`, lastValidBlockHeight: 150 };
    },
    async sendRawTransaction() {
      calls.send++;
      const outcome = script.sends[sendCall++] ?? "ok";
      if (outcome === "notFound") throw new Error("failed to send transaction: Blockhash not found");
      return "sig";
    },
    async confirmTransaction() {
      calls.confirm++;
      return { value: { err: null } };
    },
    async getBlockHeight() {
      return script.height;
    },
  };
  return { conn: conn as unknown as Connection, calls };
}

const build = (counter: { n: number }) => async () => {
  counter.n++;
  return new Transaction().add(
    SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 1 }),
  );
};
/** Stands in for the wallet: returns something serialisable, counts prompts. */
const sign = (counter: { n: number }) => async (_tx: Transaction) => {
  counter.n++;
  return { serialize: () => Buffer.from([1, 2, 3]) } as unknown as Transaction;
};

test("a wallet that beats the clock is one prompt and one send", async () => {
  const built = { n: 0 };
  const signed = { n: 0 };
  const { conn, calls } = fakeConnection({ sends: ["ok"], height: 10 });
  const sig = await signSendWithFreshHash(conn, payer, build(built), sign(signed));
  assert.equal(sig, "sig");
  assert.equal(signed.n, 1, "asked the wallet once");
  assert.equal(calls.send, 1);
});

/**
 * The regression this whole path exists for. Phantom takes twenty to thirty
 * seconds just to render on devnet; past sixty the hash is dead and no amount
 * of resending the same bytes revives it. The user's work must not be lost.
 */
test("a hash that dies in the wallet is rebuilt and asked again", async () => {
  const built = { n: 0 };
  const signed = { n: 0 };
  // Height past lastValidBlockHeight, so the failure reads as a real expiry.
  const { conn, calls } = fakeConnection({ sends: ["notFound", "ok"], height: 999 });
  const sig = await signSendWithFreshHash(conn, payer, build(built), sign(signed));
  assert.equal(sig, "sig");
  assert.equal(built.n, 2, "rebuilt, so the second attempt carries a live blockhash");
  assert.equal(signed.n, 2, "asked the wallet a second time");
  assert.equal(calls.blockhash, 2, "drew a new blockhash rather than reusing the dead one");
});

test("a wallet that misses twice fails with how long it held the transaction", async () => {
  const built = { n: 0 };
  const signed = { n: 0 };
  const { conn } = fakeConnection({ sends: ["notFound", "notFound"], height: 999 });
  await assert.rejects(
    () => signSendWithFreshHash(conn, payer, build(built), sign(signed)),
    (e: unknown) => {
      assert.ok(e instanceof BlockhashExpiredError);
      assert.equal(typeof e.heldMs, "number");
      assert.match(e.message, /held this transaction/);
      return true;
    },
  );
  assert.equal(signed.n, 2, "two prompts, never a third");
});

/**
 * A live hash rejected by a node that has not caught up is a different animal:
 * the same signed bytes are simply sent again, so it costs no wallet prompt.
 */
test("a transient rejection resends the same bytes without another prompt", async () => {
  const built = { n: 0 };
  const signed = { n: 0 };
  const { conn, calls } = fakeConnection({ sends: ["notFound", "notFound", "ok"], height: 10 });
  const sig = await signSendWithFreshHash(conn, payer, build(built), sign(signed));
  assert.equal(sig, "sig");
  assert.equal(signed.n, 1, "the wallet was not asked again");
  assert.equal(built.n, 1);
  assert.equal(calls.send, 3);
});

test("the fee payer and a blockhash are stamped before the wallet sees it", async () => {
  const seen: Transaction[] = [];
  const { conn } = fakeConnection({ sends: ["ok"], height: 10 });
  await signSendWithFreshHash(
    conn,
    payer,
    build({ n: 0 }),
    async (tx) => {
      seen.push(tx);
      return { serialize: () => Buffer.from([1]) } as unknown as Transaction;
    },
  );
  assert.equal(seen.length, 1);
  assert.ok(seen[0].recentBlockhash, "the wallet must never draw its own blockhash");
  assert.ok((seen[0].feePayer as PublicKey).equals(payer));
});
