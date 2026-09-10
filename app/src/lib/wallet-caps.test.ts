import { test } from "node:test";
import assert from "node:assert/strict";
import { knownUnableToSign } from "./wallet-caps";

/**
 * The bug these pin: the connect dialog listed Phantom and Solflare as
 * "no message signing · chat can't open a rollup session", because it asked a
 * disconnected `StandardWalletAdapter` whether it had `signMessage`. That
 * adapter deletes the method until an account is connected, so the answer was
 * always no, for every wallet, however capable.
 */

/** A disconnected standard adapter: the method is genuinely absent. */
const disconnected = { name: "Phantom" };
/** The same adapter after connecting to an account with the feature. */
const afterConnect = { name: "Phantom", signMessage: async () => new Uint8Array() };

test("a disconnected wallet is never accused of refusing to sign", () => {
  assert.equal(
    knownUnableToSign(disconnected, { connected: false, connectedName: null }),
    false,
  );
});

test("a wallet other than the connected one is never accused either", () => {
  assert.equal(
    knownUnableToSign(disconnected, { connected: true, connectedName: "Solflare" }),
    false,
  );
});

test("a connected wallet that really cannot sign is reported", () => {
  assert.equal(
    knownUnableToSign(disconnected, { connected: true, connectedName: "Phantom" }),
    true,
  );
});

test("a connected wallet that can sign is not reported", () => {
  assert.equal(
    knownUnableToSign(afterConnect, { connected: true, connectedName: "Phantom" }),
    false,
  );
});
