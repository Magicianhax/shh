import { useCallback, useEffect, useState } from "react";
import { listOpenJobs } from "@inference-market/client";
import type { AnyProgram } from "@inference-market/client";
import { errText } from "../lib/format";
import type { JobRow } from "./useJobs";
import { shouldPoll } from "../lib/rpc-priority";

const POLL_MS = 8000;

/** Every job in the `Open` state on the rollup, refreshed on an interval. */
export function useOpenJobs(er: AnyProgram | null) {
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!er) {
      setJobs(null);
      return;
    }
    try {
      const rows = await listOpenJobs(er);
      setJobs(
        rows
          .map((r) => ({ ...r, layer: "er" as const }))
          .sort(
            (a, b) =>
              Number(b.account.createdAt.toString()) - Number(a.account.createdAt.toString()),
          ),
      );
      setError(null);
    } catch (e) {
      setError(errText(e));
      setJobs((prev) => prev ?? []);
    }
  }, [er]);

  useEffect(() => {
    let stopped = false;
    const tick = () => {
      // Skipped while a transaction is in flight, or while the tab is hidden.
      // See `shouldPoll`: these sweeps are what push a send onto a lagging node.
      if (!stopped && shouldPoll()) void load();
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
