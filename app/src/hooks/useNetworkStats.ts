import { useCallback, useEffect, useMemo, useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { baseConnection, loadProgram } from "@inference-market/client";
import type { AnyProgram } from "@inference-market/client";
import { LAMPORTS, errText, num, statusKey } from "../lib/format";

export type ProviderRow = {
  publicKey: PublicKey;
  account: {
    authority: PublicKey;
    modelLabel: number[];
    completed: number;
    rejected: number;
  };
};

export type NetworkStats = {
  /** Every registered `Provider`, from the base layer. Needs no wallet. */
  providers: ProviderRow[] | null;
  /** Sum of `completed` / `rejected` across every provider. */
  completed: number | null;
  rejected: number | null;
  /** SOL held in `Escrow` accounts with `paid === false`. */
  escrowSol: number | null;
  /** Base-layer read error, if any. */
  error: string | null;
  /** Open jobs and the set of providers with a claimed job, from the rollup.
   *  Both stay null until `er` exists, because the rollup session only opens
   *  once the wallet signs the TEE auth challenge. */
  openJobs: number | null;
  working: Set<string> | null;
  rollupError: string | null;
  refreshing: boolean;
  refresh: () => void;
};

/**
 * `provider.all()` / `escrow.all()` are reads, so `AnchorProvider` never calls
 * back into this wallet — it only has to satisfy the constructor's structural
 * `Wallet` shape. `anchor.Wallet` (the concrete class) is a Node-only export
 * not present in @coral-xyz/anchor's browser bundle, so a plain object stands
 * in rather than pulling that class in.
 */
const readOnlyWallet = {
  publicKey: PublicKey.default,
  signTransaction: () => Promise.reject(new Error("read-only wallet cannot sign")),
  signAllTransactions: () => Promise.reject(new Error("read-only wallet cannot sign")),
};

/**
 * Network-wide figures for the Provider page's "Network" section.
 *
 * `provider.all()` and `escrow.all()` never need a signer, so they are read
 * through a throwaway read-only connection independent of the connected
 * wallet — these numbers show up even before a wallet connects. The rollup
 * figures (open jobs, who is working right now) come from `er.account.job.all()`
 * and stay an em dash until `er` exists.
 *
 * No polling: this fetches once on mount, again on window focus, and whenever
 * `refresh()` is called (the caller wires that to a manual affordance and to
 * a successful `register_provider`).
 */
export function useNetworkStats(er: AnyProgram | null): NetworkStats {
  const readOnlyBase = useMemo(
    () =>
      loadProgram(
        new anchor.AnchorProvider(baseConnection(), readOnlyWallet, { commitment: "confirmed" }),
      ),
    [],
  );

  const [providers, setProviders] = useState<ProviderRow[] | null>(null);
  const [escrowSol, setEscrowSol] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [openJobs, setOpenJobs] = useState<number | null>(null);
  const [working, setWorking] = useState<Set<string> | null>(null);
  const [rollupError, setRollupError] = useState<string | null>(null);

  const [refreshing, setRefreshing] = useState(false);

  const loadBase = useCallback(async () => {
    try {
      const [rawProviders, escrows] = await Promise.all([
        readOnlyBase.account.provider.all() as Promise<ProviderRow[]>,
        readOnlyBase.account.escrow.all() as Promise<{ account: { amount: any; paid: boolean } }[]>,
      ]);
      setProviders(rawProviders);
      const lamports = escrows
        .filter((e) => !e.account.paid)
        .reduce((sum, e) => sum + num(e.account.amount), 0);
      setEscrowSol(lamports / LAMPORTS);
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [readOnlyBase]);

  const loadRollup = useCallback(async () => {
    if (!er) {
      setOpenJobs(null);
      setWorking(null);
      setRollupError(null);
      return;
    }
    try {
      const jobs = (await er.account.job.all()) as { account: any }[];
      let open = 0;
      const live = new Set<string>();
      for (const j of jobs) {
        const status = statusKey(j.account.status);
        if (status === "open") open += 1;
        else if (status === "claimed") live.add((j.account.provider as PublicKey).toBase58());
      }
      setOpenJobs(open);
      setWorking(live);
      setRollupError(null);
    } catch (e) {
      setRollupError(errText(e));
    }
  }, [er]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void Promise.allSettled([loadBase(), loadRollup()]).finally(() => setRefreshing(false));
  }, [loadBase, loadRollup]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [er]);

  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const completed = providers ? providers.reduce((s, p) => s + p.account.completed, 0) : null;
  const rejected = providers ? providers.reduce((s, p) => s + p.account.rejected, 0) : null;

  return {
    providers,
    completed,
    rejected,
    escrowSol,
    error,
    openJobs,
    working,
    rollupError,
    refreshing,
    refresh,
  };
}
