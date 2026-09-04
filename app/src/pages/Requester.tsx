import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cancelJobBase,
  closeJob,
  escrowPda,
  finishJob,
  readPrivate,
  settleDirect,
} from "@inference-market/client";
import type { FinishKind } from "@inference-market/client";
import { JobCard } from "../components/JobCard";
import { JobDetail } from "../components/JobDetail";
import type { EscrowView } from "../components/JobDetail";
import { NewJobForm } from "../components/NewJobForm";
import { RefreshIcon } from "../components/icons";
import { useActionEscrow, TOP_UP_LAMPORTS } from "../hooks/useActionEscrow";
import { useJobs } from "../hooks/useJobs";
import type { Market } from "../hooks/useMarket";
import { useNotify } from "../notify";
import { LAMPORTS, errText, isTerminal, num, shortKey, statusKey } from "../lib/format";

const PAST_LABEL: Record<FinishKind, string> = {
  approve: "Approved",
  reject: "Rejected",
  cancel: "Cancelled",
  expire: "Expired",
};

export function Requester({ market }: { market: Market }) {
  const { base, er, wallet, connection } = market;
  const notify = useNotify();
  const owner = wallet.publicKey;

  const mine = useCallback(
    (account: any) => Boolean(owner && account.requester.equals(owner)),
    [owner],
  );
  const { jobs, refresh } = useJobs(base, er, mine);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [escrow, setEscrow] = useState<EscrowView>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const actionEscrow = useActionEscrow(connection, wallet);

  const row = useMemo(
    () => jobs?.find((j) => j.publicKey.toBase58() === selectedKey) ?? null,
    [jobs, selectedKey],
  );

  // Keep a selection alive as the list refreshes; fall back to the newest job.
  useEffect(() => {
    if (!jobs?.length) return;
    if (!selectedKey || !jobs.some((j) => j.publicKey.toBase58() === selectedKey)) {
      setSelectedKey(jobs[0].publicKey.toBase58());
    }
  }, [jobs, selectedKey]);

  const refreshEscrow = useCallback(async () => {
    if (!base || !row) {
      setEscrow(null);
      return;
    }
    try {
      setEscrow(await base.account.escrow.fetchNullable(escrowPda(row.publicKey)));
    } catch {
      setEscrow(null);
    }
  }, [base, row]);

  useEffect(() => {
    void refreshEscrow();
  }, [refreshEscrow, jobs]);

  // The private buffers only exist while the job is delegated. Decoded here and
  // rendered as text; never logged, never sent anywhere.
  useEffect(() => {
    if (!er || !row || row.layer !== "er") {
      setOutput(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { output: bytes } = await readPrivate(er, row.publicKey);
        if (!cancelled) setOutput(bytes.length ? new TextDecoder().decode(bytes) : null);
      } catch {
        if (!cancelled) setOutput(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [er, row, jobs]);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
      await refresh();
      await refreshEscrow();
    } catch (e) {
      notify("err", `${name} failed`, errText(e));
    } finally {
      setBusy(null);
    }
  };

  const finish = (kind: FinishKind) =>
    run(kind, async () => {
      if (!er || !owner || !row) return;
      const { erSig } = await finishJob(er, owner, row.publicKey, kind, actionEscrow.funded);
      notify(
        "ok",
        `${PAST_LABEL[kind]} on the rollup`,
        actionEscrow.funded
          ? `Settlement scheduled with the commit · ${shortKey(erSig, 8)}`
          : `Commit sent · ${shortKey(erSig, 8)}. Settle it once devnet has the job back.`,
      );
    });

  const status = row ? statusKey(row.account.status) : null;
  const terminal = row ? isTerminal(row.account.status) : false;
  const pastDeadline = row ? num(row.account.deadlineUnix) * 1000 <= Date.now() : false;
  const onErNow = row?.layer === "er";
  const canSettle = Boolean(row && !onErNow && terminal && escrow && !escrow.paid);
  const canClose = Boolean(row && terminal && escrow?.paid);

  return (
    <div className="shell">
      <div className="col">
        <NewJobForm market={market} onPublished={(job) => setSelectedKey(job.toBase58())} />

        <section className="panel">
          <div className="panel-head">
            <h2>Your jobs</h2>
            <span className="count">{jobs ? jobs.length : "—"}</span>
            <button
              type="button"
              className="iconbtn"
              onClick={() => void refresh()}
              aria-label="Refresh job list"
            >
              <RefreshIcon />
            </button>
          </div>

          {!owner ? (
            <div className="empty">
              <h3>Wallet not connected</h3>
              <p>Connect a wallet to post jobs and to see the ones you already posted.</p>
            </div>
          ) : jobs === null ? (
            <div>
              {[0, 1, 2].map((i) => (
                <div className="skeleton-row" key={i}>
                  <div className="skeleton" style={{ width: "58%" }} />
                  <div className="skeleton" style={{ width: "34%" }} />
                </div>
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <div className="empty">
              <h3>No jobs yet</h3>
              <p>
                Post one above. It appears here as Created, flips to Open once the prompt is sealed
                in the rollup, then moves as a provider claims and answers it.
              </p>
            </div>
          ) : (
            <div className="list">
              {jobs.map((j) => (
                <JobCard
                  key={j.publicKey.toBase58()}
                  row={j}
                  selected={j.publicKey.toBase58() === selectedKey}
                  onSelect={() => setSelectedKey(j.publicKey.toBase58())}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="col">
        {row ? (
          <JobDetail row={row} escrow={escrow}>
            <div className="section">
              <div className="section-head">
                <h3>Result</h3>
              </div>
              {output ? (
                <pre className="output">{output}</pre>
              ) : (
                <p className="note">
                  {onErNow
                    ? "No output yet. It is readable here as soon as a provider submits, and only by wallets on the job's permission list."
                    : "The private buffers were scrubbed when the job left the rollup."}
                </p>
              )}
            </div>

            <div className="section">
              <div className="section-head">
                <h3>Settlement</h3>
                <span className="spacer" />
                <span className="sub">
                  {actionEscrow.lamports === null
                    ? "checking action escrow"
                    : `action escrow ${(actionEscrow.lamports / LAMPORTS).toFixed(4)} SOL`}
                </span>
              </div>

              {!actionEscrow.funded ? (
                <p className="note note-warn" style={{ marginBottom: 10 }}>
                  Your action escrow is empty, so approving cannot pay out atomically with the
                  commit. Fund it once, or approve now and press Settle now afterwards.
                </p>
              ) : null}

              <div className="actions">
                {!actionEscrow.funded ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={actionEscrow.busy || !owner}
                    onClick={() =>
                      void run("Fund action escrow", async () => {
                        const sig = await actionEscrow.fund();
                        notify(
                          "ok",
                          "Action escrow funded",
                          `${TOP_UP_LAMPORTS / LAMPORTS} SOL · ${shortKey(sig, 8)}`,
                        );
                      })
                    }
                  >
                    {actionEscrow.busy ? <i className="spin" /> : null}
                    Fund action escrow
                  </button>
                ) : null}

                {status === "submitted" ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy !== null}
                      onClick={() => void finish("approve")}
                    >
                      {busy === "approve" ? <i className="spin" /> : null}
                      Approve and pay
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={busy !== null}
                      onClick={() => void finish("reject")}
                    >
                      {busy === "reject" ? <i className="spin" /> : null}
                      Reject and refund
                    </button>
                  </>
                ) : null}

                {status === "created" ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy !== null}
                    onClick={() =>
                      void run("cancel", async () => {
                        if (!base || !owner || !row) return;
                        await cancelJobBase(base, owner, row.publicKey);
                        notify("ok", "Job cancelled", "It never reached the rollup.");
                      })
                    }
                  >
                    {busy === "cancel" ? <i className="spin" /> : null}
                    Cancel job
                  </button>
                ) : null}

                {status === "open" ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy !== null}
                    onClick={() => void finish("cancel")}
                  >
                    {busy === "cancel" ? <i className="spin" /> : null}
                    Cancel job
                  </button>
                ) : null}

                {onErNow && pastDeadline && (status === "open" || status === "claimed") ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy !== null}
                    onClick={() => void finish("expire")}
                  >
                    {busy === "expire" ? <i className="spin" /> : null}
                    Expire and refund
                  </button>
                ) : null}

                {canSettle ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy !== null}
                    onClick={() =>
                      void run("Settle", async () => {
                        if (!base || !owner || !row) return;
                        const sig = await settleDirect(base, owner, row.publicKey);
                        notify("ok", "Escrow settled", `Signature ${shortKey(sig, 8)}`);
                      })
                    }
                  >
                    {busy === "Settle" ? <i className="spin" /> : null}
                    Settle now
                  </button>
                ) : null}

                {canClose ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy !== null}
                    onClick={() =>
                      void run("Close", async () => {
                        if (!base || !owner || !row) return;
                        const sig = await closeJob(base, owner, row.publicKey);
                        notify("ok", "Job closed", `Rent reclaimed · ${shortKey(sig, 8)}`);
                        setSelectedKey(null);
                      })
                    }
                  >
                    {busy === "Close" ? <i className="spin" /> : null}
                    Close and reclaim rent
                  </button>
                ) : null}

                {terminal && !canSettle && !canClose && onErNow ? (
                  <p className="sub">Waiting for the commit to land back on devnet.</p>
                ) : null}
              </div>
            </div>
          </JobDetail>
        ) : (
          <section className="panel panel-fill">
            <div className="empty">
              <h3>Nothing selected</h3>
              <p>
                Pick a job to see its hashes, its escrow and the output the provider sealed in the
                rollup.
              </p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
