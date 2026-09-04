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
  teeIdentity,
} from "@inference-market/client";
import type { AnyProgram } from "@inference-market/client";
import { errText } from "../lib/format";

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

/** Re-authenticate this many seconds before the TEE token lapses. */
const RENEW_LEAD_SECS = 60;

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
      setEr(null);
      setValidator(null);
      setTeeError(null);
      return;
    }

    let cancelled = false;
    let renewTimer = 0;
    const w = walletRef.current;

    setConnecting(true);
    setTeeError(null);

    (async () => {
      try {
        const [{ connection: tee, expiresAt }, identity] = await Promise.all([
          authedTeeConnection(TEE_URL, w.publicKey!, w.signMessage!),
          teeIdentity(TEE_URL),
        ]);
        if (cancelled) return;
        setEr(
          loadProgram(
            new anchor.AnchorProvider(tee, walletRef.current as unknown as anchor.Wallet, {
              commitment: "confirmed",
            }),
          ),
        );
        setValidator(identity);

        const msUntilRenew = (expiresAt - RENEW_LEAD_SECS) * 1000 - Date.now();
        if (Number.isFinite(msUntilRenew) && msUntilRenew > 0) {
          renewTimer = window.setTimeout(() => setAttempt((n) => n + 1), msUntilRenew);
        }
      } catch (e) {
        if (!cancelled) {
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

  const reconnectTee = useCallback(() => setAttempt((n) => n + 1), []);

  return { base, er, router, validator, wallet, connection, connecting, teeError, reconnectTee };
}
