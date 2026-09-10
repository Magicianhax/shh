import { useCallback, useEffect, useState } from "react";
import { Transaction } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { escrowPdaFromEscrowAuthority } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  ACTION_ESCROW_INDEX,
  ACTION_TOP_UP_LAMPORTS,
  topUpActionEscrowIx,
} from "@inference-market/client";

export const TOP_UP_LAMPORTS = ACTION_TOP_UP_LAMPORTS;

/**
 * The delegation-program ephemeral balance that pays for a scheduled
 * `settle_action`. Without it, approve/reject must run with
 * `scheduleAction = false` and be settled afterwards with `settleDirect`.
 *
 * The first message a wallet sends folds this top-up into its own base-layer
 * transaction (see `useChat`), so in the normal flow the escrow is already
 * funded by the time there is anything to approve. This hook stays as the
 * explicit control for topping it up again, and for reading the balance.
 */
export function useActionEscrow(connection: Connection, wallet: WalletContextState) {
  const [lamports, setLamports] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const owner = wallet.publicKey;

  const refresh = useCallback(async () => {
    if (!owner) {
      setLamports(null);
      return;
    }
    const pda = escrowPdaFromEscrowAuthority(owner, ACTION_ESCROW_INDEX);
    setLamports(await connection.getBalance(pda, "confirmed"));
  }, [connection, owner]);

  useEffect(() => {
    void refresh().catch(() => setLamports(null));
  }, [refresh]);

  const fund = useCallback(async (): Promise<string> => {
    if (!owner) throw new Error("Connect a wallet first.");
    setBusy(true);
    try {
      const tx = new Transaction().add(topUpActionEscrowIx(owner, TOP_UP_LAMPORTS));
      const sig = await wallet.sendTransaction(tx, connection);
      const bh = await connection.getLatestBlockhash("confirmed");
      await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      await refresh();
      return sig;
    } finally {
      setBusy(false);
    }
  }, [connection, owner, refresh, wallet]);

  /**
   * Credit a top-up that has already confirmed, without waiting for the read
   * back. `useChat` folds the top-up into the first message's own transaction
   * and the approval that follows must see a funded escrow, or it would decline
   * to schedule its payout and cost the user an extra signature to settle.
   */
  const markFunded = useCallback((added: number) => {
    setLamports((l) => (l ?? 0) + added);
  }, []);

  return {
    lamports,
    /** A scheduled Magic Action is only affordable once this escrow holds something. */
    funded: lamports !== null && lamports > 0,
    busy,
    fund,
    markFunded,
    refresh,
  };
}
