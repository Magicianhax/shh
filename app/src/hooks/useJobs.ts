import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import type { AnyProgram } from "@inference-market/client";
import { errText } from "../lib/format";

export type JobRow = {
  publicKey: PublicKey;
  account: any;
  /** Where this copy came from: `er` means the job is still delegated and live. */
  layer: "base" | "er";
};

const POLL_MS = 8000;

/**
 * Every job the wallet cares about, merged across both layers.
 *
 * The base layer only returns jobs the program still owns, so a delegated job
 * disappears from it while it is live on the ephemeral rollup. Fetch both and
 * let the ER copy win, so the row keeps moving through Open → Claimed →
 * Submitted while the base copy is frozen at Created.
 */
export function useJobs(
  base: AnyProgram | null,
  er: AnyProgram | null,
  match: (account: any) => boolean,
) {
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const matchRef = useRef(match);
  matchRef.current = match;

  const load = useCallback(async () => {
    if (!base) {
      setJobs(null);
      return;
    }
    try {
      const [baseRes, erRes] = await Promise.allSettled([
        base.account.job.all(),
        er ? er.account.job.all() : Promise.resolve([]),
      ]);

      if (baseRes.status === "rejected") throw baseRes.reason;

      const merged = new Map<string, JobRow>();
      for (const row of baseRes.value as any[]) {
        merged.set(row.publicKey.toBase58(), { ...row, layer: "base" });
      }
      if (erRes.status === "fulfilled") {
        for (const row of erRes.value as any[]) {
          merged.set(row.publicKey.toBase58(), { ...row, layer: "er" });
        }
      }

      const rows = [...merged.values()]
        .filter((r) => matchRef.current(r.account))
        .sort((a, b) => Number(b.account.createdAt.toString()) - Number(a.account.createdAt.toString()));

      setJobs(rows);
      setError(erRes.status === "rejected" ? errText(erRes.reason) : null);
    } catch (e) {
      setError(errText(e));
      setJobs((prev) => prev ?? []);
    }
  }, [base, er]);

  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (!stopped) void load();
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [load]);

  return { jobs, error, refresh: load };
}
