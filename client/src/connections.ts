import { Connection, PublicKey } from "@solana/web3.js";
import { ConnectionMagicRouter, getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import { BASE_URL, ROUTER_URL, PROGRAM_ID } from "./constants";

export const baseConnection = (): Connection => new Connection(BASE_URL, "confirmed");

/**
 * Router connection used only for `getDelegationStatus`.
 * The SDK appends `/getDelegationStatus` to `rpcEndpoint`, so a trailing slash
 * on `ROUTER_URL` would produce a double-slash path. Strip it here.
 */
export const routerConnection = (): ConnectionMagicRouter =>
  new ConnectionMagicRouter(ROUTER_URL.replace(/\/+$/, ""), "confirmed");

/** Identity pubkey of a TEE validator, via its `getIdentity` JSON-RPC method. */
export async function teeIdentity(teeUrl: string): Promise<PublicKey> {
  const res = await fetch(teeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getIdentity", params: [] }),
  });
  const body: any = await res.json();
  if (body?.error) throw new Error(`getIdentity failed: ${JSON.stringify(body.error)}`);
  return new PublicKey(body.result.identity);
}

export type AuthedTeeConnection = {
  connection: Connection;
  token: string;
  expiresAt: number;
};

/**
 * Build a TEE ER connection carrying an auth token in the query string.
 * `signMessage` signs the challenge with the key that will read the private
 * account; the resulting token scopes reads to that identity.
 */
/**
 * Build a rollup connection from a token that was already issued. The token is
 * what the endpoint authenticates on, so a cached one lets a reload skip the
 * signature prompt entirely.
 */
export function teeConnectionFromToken(teeUrl: string, token: string): Connection {
  const sep = teeUrl.includes("?") ? "&" : "?";
  return new Connection(`${teeUrl}${sep}token=${token}`, {
    wsEndpoint: `${teeUrl.replace(/^http/, "ws")}${sep}token=${token}`,
    commitment: "confirmed",
  });
}

export async function authedTeeConnection(
  teeUrl: string,
  pubkey: PublicKey,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<AuthedTeeConnection> {
  const { token, expiresAt } = await getAuthToken(teeUrl, pubkey, signMessage);
  // The endpoint may already carry a query string; appending a second "?" would
  // make the token part of the previous parameter's value.
  const sep = teeUrl.includes("?") ? "&" : "?";
  const http = `${teeUrl}${sep}token=${token}`;
  const ws = `${teeUrl.replace(/^http/, "ws")}${sep}token=${token}`;
  return {
    connection: new Connection(http, { wsEndpoint: ws, commitment: "confirmed" }),
    token,
    expiresAt,
  };
}

/**
 * Poll the router until every account is delegated to the *same* ER, and return
 * that ER's fqdn. A split across validators is never usable, so it is treated
 * as not-yet-ready rather than success.
 */
export async function waitForDelegation(
  router: ConnectionMagicRouter,
  accounts: PublicKey[],
  timeoutMs = 60_000,
): Promise<string> {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < timeoutMs) {
    const statuses = await Promise.all(
      accounts.map((a) => router.getDelegationStatus(a) as Promise<any>),
    );
    const fqdns = statuses.map((s) => (s?.isDelegated ? s.fqdn : undefined));
    if (fqdns.every((f) => typeof f === "string") && new Set(fqdns).size === 1) {
      return fqdns[0] as string;
    }
    last = JSON.stringify(fqdns);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `delegation not observed on a single ER within ${timeoutMs}ms (last: ${last})`,
  );
}

/**
 * Poll the base layer until `account` is owned by the program again, i.e. the
 * delegation program has returned it via `process_undelegation`.
 */
export async function waitForUndelegation(
  base: Connection,
  account: PublicKey,
  timeoutMs = 90_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await base.getAccountInfo(account, "confirmed");
    if (info && info.owner.equals(PROGRAM_ID)) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(
    `undelegation of ${account.toBase58()} not observed within ${timeoutMs}ms`,
  );
}
