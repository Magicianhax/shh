import { useCallback, useEffect, useRef, useState } from "react";
import type { Connection, PublicKey } from "@solana/web3.js";
import { shouldPoll } from "../lib/rpc-priority";

const POLL_MS = 20_000;

export type Balance = {
  lamports: number | null;
  /** Re-reads immediately, bypassing the poll interval. */
  refresh: () => void;
};

/**
 * Devnet SOL balance of the connected wallet, in lamports.
 *
 * Reads on mount, every `POLL_MS`, on window focus (a tab switch after using
 * a faucet is the common case), and on demand via `refresh`.
 */
export function useBalance(connection: Connection, owner: PublicKey | null): Balance {
  const [lamports, setLamports] = useState<number | null>(null);
  const key = owner?.toBase58() ?? null;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;

  const read = useCallback(async () => {
    const o = ownerRef.current;
    if (!o) return;
    try {
      const value = await connection.getBalance(o, "confirmed");
      setLamports(value);
    } catch {
      setLamports(null);
    }
  }, [connection]);

  useEffect(() => {
    if (!owner) {
      setLamports(null);
      return;
    }
    let stopped = false;
    const safeRead = () => {
      if (!stopped && shouldPoll()) void read();
    };

    safeRead();
    const id = window.setInterval(safeRead, POLL_MS);
    window.addEventListener("focus", safeRead);
    return () => {
      stopped = true;
      window.clearInterval(id);
      window.removeEventListener("focus", safeRead);
    };
    // `key` stands in for `owner`, whose object identity changes on every render
    // while the base58 address does not.
  }, [connection, key, owner, read]);

  const refresh = useCallback(() => void read(), [read]);

  return { lamports, refresh };
}
