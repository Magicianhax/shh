/**
 * What a wallet can do, and — more importantly — when that is knowable.
 *
 * `StandardWalletAdapter` attaches `signMessage` only once an account is
 * connected *and* that account reports the `solana:signMessage` feature;
 * before then it deletes the method outright. So inspecting a disconnected
 * adapter says nothing about the wallet, and reading it as a "no" told every
 * visitor that Phantom and Solflare could not sign messages. Verified against
 * the live Wallet Standard registry: Phantom advertises `solana:signMessage`
 * while its disconnected adapter still reports the method missing.
 */

/** The sliver of a wallet adapter these checks need. */
export type AdapterLike = { name: string };

/**
 * Whether a wallet is *known* to refuse message signing.
 *
 * False for anything not yet connected, because at that point there is no
 * evidence either way, and an unfounded warning is worse than none: it sends
 * people away from a wallet that would have worked.
 */
export function knownUnableToSign(
  adapter: AdapterLike,
  opts: { connected: boolean; connectedName: string | null },
): boolean {
  if (!opts.connected) return false;
  if (opts.connectedName !== adapter.name) return false;
  return !("signMessage" in adapter);
}
