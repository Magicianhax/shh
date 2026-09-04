import { useCallback, useEffect, useState } from "react";
import { LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import {
  createTopUpEscrowInstruction,
  escrowPdaFromEscrowAuthority,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { ACTION_ESCROW_INDEX } from "@inference-market/client";

export const TOP_UP_LAMPORTS = 0.01 * LAMPORTS_PER_SOL;

/**
 * The delegation-program ephemeral balance that pays for a scheduled
 * `settle_action`. Without it, approve/reject must run with
 * `scheduleAction = false` and be settled afterwards with `settleDirect`.
 *
 * The client's `topUpActionEscrow` takes a `Keypair`; a browser wallet has no
 * secret key, so the same instruction is built here and sent through the
 * adapter.
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
      const pda = escrowPdaFromEscrowAuthority(owner, ACTION_ESCROW_INDEX);
      const tx = new Transaction().add(
        createTopUpEscrowInstruction(pda, owner, owner, TOP_UP_LAMPORTS, ACTION_ESCROW_INDEX),
      );
      const sig = await wallet.sendTransaction(tx, connection);
      const bh = await connection.getLatestBlockhash("confirmed");
      await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      await refresh();
      return sig;
    } finally {
      setBusy(false);
    }
  }, [connection, owner, refresh, wallet]);

  return {
    lamports,
    /** A scheduled Magic Action is only affordable once this escrow holds something. */
    funded: lamports !== null && lamports > 0,
    busy,
    fund,
    refresh,
  };
}
