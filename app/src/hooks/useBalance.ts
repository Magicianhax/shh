import { useEffect, useState } from "react";
import type { Connection, PublicKey } from "@solana/web3.js";

const POLL_MS = 20_000;

/** Devnet SOL balance of the connected wallet, in lamports. */
export function useBalance(connection: Connection, owner: PublicKey | null): number | null {
  const [lamports, setLamports] = useState<number | null>(null);
  const key = owner?.toBase58() ?? null;

  useEffect(() => {
    if (!owner) {
      setLamports(null);
      return;
    }
    let stopped = false;

    const read = async () => {
      try {
        const value = await connection.getBalance(owner, "confirmed");
        if (!stopped) setLamports(value);
      } catch {
        if (!stopped) setLamports(null);
      }
    };

    void read();
    const id = window.setInterval(() => void read(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
    // `key` stands in for `owner`, whose object identity changes on every render
    // while the base58 address does not.
  }, [connection, key, owner]);

  return lamports;
}
