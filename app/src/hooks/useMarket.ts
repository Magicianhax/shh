import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import type { Connection, PublicKey } from "@solana/web3.js";
import type { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  TEE_URL,
  authedTeeConnection,
  loadProgram,
  routerConnection,
  teeConnectionFromToken,
  teeIdentity,
} from "@inference-market/client";
import type { AnyProgram } from "@inference-market/client";
import { errText } from "../lib/format";
import { clearSession, loadSession, renewDelayMs, saveSession } from "../lib/tee-session";

export type Market = {
  /** Program bound to Solana devnet. Null until a wallet that can sign is connected. */
  base: AnyProgram | null;
  /** Program bound to the authenticated TEE ephemeral rollup. Null until the challenge is signed. */
  er: AnyProgram | null;
  router: ConnectionMagicRouter;
  /** TEE validator identity, the delegation target for `publishJob`. */
  validator: PublicKey | null;
  wallet: WalletContextState;
  connection: Connection;
  /** True while the TEE session is being negotiated. */
  connecting: boolean;
  /** Last TEE authentication failure, already sanitised. */
  teeError: string | null;
  reconnectTee: () => void;
};

/**
 * The rollup session is opened with a signed challenge, so every re-run of the
 * effect below costs the user a wallet dialog. It must therefore run only when
 * the connected key changes or the token is genuinely near expiry: a cached
 * token is reused across reloads, and the renewal timer is scheduled through
 * `renewDelayMs`, which refuses delays past the 32-bit ceiling instead of
 * letting `setTimeout` truncate them and fire at once.
 */

export function useMarket(): Market {
  const { connection } = useConnection();
  const wallet = useWallet();
  const router = useMemo(() => routerConnection(), []);

  const [er, setEr] = useState<AnyProgram | null>(null);
  const [validator, setValidator] = useState<PublicKey | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [teeError, setTeeError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const owner = wallet.publicKey?.toBase58() ?? null;
  const canSignTx = Boolean(wallet.signTransaction);
  const canSignMsg = Boolean(wallet.signMessage);

  // `wallet` is a fresh object every render; hold it in a ref so the TEE effect
  // depends only on the connected key, not on render identity.
  const lastOwner = useRef<string | null>(null);
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  const base = useMemo(
    () =>
      owner && canSignTx
        ? loadProgram(
            new anchor.AnchorProvider(connection, walletRef.current as unknown as anchor.Wallet, {
              commitment: "confirmed",
            }),
          )
        : null,
    [connection, owner, canSignTx],
  );

  useEffect(() => {
    if (!owner || !canSignMsg) {
      // Disconnecting is a deliberate signal, so the bearer token goes with it
      // rather than waiting for the tab to close.
      if (lastOwner.current) clearSession(lastOwner.current);
      lastOwner.current = null;
      setEr(null);
      setValidator(null);
      setTeeError(null);
      return;
    }
    lastOwner.current = owner;

    let cancelled = false;
    let renewTimer = 0;
    const w = walletRef.current;

    setConnecting(true);
    setTeeError(null);

    (async () => {
      try {
        const cached = loadSession(owner);
        const [session, identity] = await Promise.all([
          cached
            ? Promise.resolve({
                connection: teeConnectionFromToken(TEE_URL, cached.token),
                expiresAt: cached.expiresAt,
              })
            : authedTeeConnection(TEE_URL, w.publicKey!, w.signMessage!).then((s) => {
                saveSession(owner, { token: s.token, expiresAt: s.expiresAt });
                return { connection: s.connection, expiresAt: s.expiresAt };
              }),
          teeIdentity(TEE_URL),
        ]);
        const { connection: tee, expiresAt } = session;
        if (cancelled) return;
        setEr(
          loadProgram(
            new anchor.AnchorProvider(tee, walletRef.current as unknown as anchor.Wallet, {
              commitment: "confirmed",
            }),
          ),
        );
        setValidator(identity);

        const due = renewDelayMs(expiresAt);
        if (due !== null) {
          renewTimer = window.setTimeout(() => {
            clearSession(owner);
            setAttempt((n) => n + 1);
          }, due);
        }
      } catch (e) {
        if (!cancelled) {
          // A cached token the endpoint no longer honours must not be retried
          // on the next mount, or the failure becomes permanent.
          clearSession(owner);
          setEr(null);
          setTeeError(errText(e));
        }
      } finally {
        if (!cancelled) setConnecting(false);
      }
    })();

    return () => {
      cancelled = true;
      if (renewTimer) window.clearTimeout(renewTimer);
    };
  }, [owner, canSignMsg, attempt]);

  const reconnectTee = useCallback(() => {
    if (owner) clearSession(owner);
    setAttempt((n) => n + 1);
  }, [owner]);

  return { base, er, router, validator, wallet, connection, connecting, teeError, reconnectTee };
}
