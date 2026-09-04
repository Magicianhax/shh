import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AUTO_APPROVE_SECS,
  cancelJobBase,
  closeJob,
  escrowPda,
  finishJob,
  readPrivate,
  settleDirect,
} from "@inference-market/client";
import type { FinishKind } from "@inference-market/client";
import { Pipeline, StateWord } from "../components/Pipeline";
import { Sealed } from "../components/Sealed";
import { useActionEscrow, TOP_UP_LAMPORTS } from "../hooks/useActionEscrow";
import { useJobs } from "../hooks/useJobs";
import type { JobRow } from "../hooks/useJobs";
import type { Market } from "../hooks/useMarket";
import { useNow } from "../hooks/useNow";
import { useNotify } from "../notify";
import { timeline } from "../lib/timeline";
import {
  LAMPORTS,
  byteLen,
  countdown,
  errText,
  hexPreview,
  isTerminal,
  isUnset,
  labelText,
  num,
  shortKey,
  solText,
  statusKey,
  timeText,
} from "../lib/format";

export function Jobs({ market }: { market: Market }) {
  const { base, er, wallet, connection } = market;
  const notify = useNotify();
  const owner = wallet.publicKey ?? null;
  const now = useNow();

  const mine = useCallback(
    (a: any) => Boolean(owner && a.requester.equals(owner)),
    [owner],
  );
  const { jobs, refresh } = useJobs(base, er, mine);
  const actionEscrow = useActionEscrow(connection, wallet);

  const [selected, setSelected] = useState<string | null>(null);
  const [escrow, setEscrow] = useState<{ amount: any; paid: boolean } | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const row = useMemo(
    () => jobs?.find((j) => j.publicKey.toBase58() === selected) ?? null,
    [jobs, selected],
  );

  useEffect(() => {
    if (!jobs?.length) return;
    if (!selected || !jobs.some((j) => j.publicKey.toBase58() === selected)) {
      setSelected(jobs[0].publicKey.toBase58());
    }
  }, [jobs, selected]);

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

  // Private buffers exist only while the job is delegated. Decoded here and
  // rendered behind a seal; never logged, never forwarded.
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
    setError(null);
    try {
      await fn();
      await refresh();
      await refreshEscrow();
    } catch (e) {
      setError(errText(e));
      notify("err", `${name} failed`);
    } finally {
      setBusy(null);
    }
  };

  const finish = (kind: FinishKind) =>
    run(kind, async () => {
      if (!er || !owner || !row) return;
      await finishJob(er, owner, row.publicKey, kind, actionEscrow.funded);
      notify("ok", actionEscrow.funded ? `${kind}d · settling with the commit` : `${kind}d · settle when it lands`);
    });

  const status = row ? statusKey(row.account.status) : null;
  const terminal = row ? isTerminal(row.account.status) : false;
  const onEr = row?.layer === "er";
  const pastDeadline = row ? num(row.account.deadlineUnix) * 1000 <= now : false;
  const canSettle = Boolean(row && !onEr && terminal && escrow && !escrow.paid);
  const canClose = Boolean(row && terminal && escrow?.paid);

  const counts = jobs
    ? `${jobs.length} total · ${jobs.filter((j) => !isTerminal(j.account.status)).length} in progress`
    : "";

  return (
    <div className="page">
      <div className="page-head">
        <h2>Your jobs</h2>
        <span style={{ fontSize: 14, color: "var(--muted)" }}>{counts}</span>
      </div>

      {!owner ? (
        <p className="empty">connect a wallet to see the jobs you posted</p>
      ) : jobs === null ? (
        <div className="rows">
          {[0, 1, 2].map((i) => (
            <div className="row" key={i} style={{ cursor: "default" }}>
              <div className="row-title">
                <b style={{ color: "var(--faint)" }}>loading…</b>
              </div>
            </div>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <p className="empty">no jobs yet · every chat message you send appears here</p>
      ) : (
        <div className="jobs-grid">
          <div className="rows">
            {jobs.map((j) => (
              <Row
                key={j.publicKey.toBase58()}
                row={j}
                now={now}
                selected={j.publicKey.toBase58() === selected}
                paid={j.publicKey.toBase58() === selected ? escrow?.paid : undefined}
                onSelect={() => setSelected(j.publicKey.toBase58())}
              />
            ))}
          </div>

          {row ? (
            <div className="detail">
              <div className="detail-main">
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <h3>{labelText(row.account.modelLabel) || "unlabelled model"}</h3>
                  <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
                    {shortKey(row.publicKey, 6)}
                    {isUnset(row.account.provider)
                      ? " · unclaimed"
                      : ` · claimed by ${shortKey(row.account.provider, 4)}`}
                    {num(row.account.submittedAt) > 0
                      ? ` · submitted ${timeText(row.account.submittedAt).split(", ")[1] ?? ""}`
                      : ""}
                  </span>
                </div>

                {output ? (
                  <Sealed
                    text={output}
                    label={`Output · ${byteLen(output).toLocaleString()} bytes`}
                    hash={hexPreview(row.account.outputHash)}
                    counterparty={
                      isUnset(row.account.provider)
                        ? "the provider"
                        : shortKey(row.account.provider, 4)
                    }
                  />
                ) : (
                  <p className="empty" style={{ padding: 0 }}>
                    {onEr
                      ? "no output yet · it unseals here the moment a provider submits"
                      : "the private buffers were wiped when the job left the rollup"}
                  </p>
                )}

                <div className="msg-actions" style={{ marginTop: 4 }}>
                  {status === "submitted" ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-ink"
                        disabled={busy !== null}
                        onClick={() => void finish("approve")}
                      >
                        Approve · pay {solText(row.account.priceLamports)} SOL
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy !== null}
                        onClick={() => void finish("reject")}
                      >
                        Reject · refund
                      </button>
                    </>
                  ) : null}

                  {status === "open" ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy !== null}
                      onClick={() => void finish("cancel")}
                    >
                      Cancel · refund
                    </button>
                  ) : null}

                  {status === "created" ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy !== null}
                      onClick={() =>
                        void run("cancel", async () => {
                          if (!base || !owner || !row) return;
                          await cancelJobBase(base, owner, row.publicKey);
                          notify("ok", "cancelled before it reached the rollup");
                        })
                      }
                    >
                      Cancel · refund
                    </button>
                  ) : null}

                  {onEr && pastDeadline && (status === "open" || status === "claimed") ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy !== null}
                      onClick={() => void finish("expire")}
                    >
                      Expire · refund
                    </button>
                  ) : null}

                  {!actionEscrow.funded ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={actionEscrow.busy}
                      onClick={() =>
                        void run("fund", async () => {
                          await actionEscrow.fund();
                          notify("ok", `action escrow funded · ${TOP_UP_LAMPORTS / LAMPORTS} SOL`);
                        })
                      }
                    >
                      Fund action escrow
                    </button>
                  ) : null}

                  {canSettle ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy !== null}
                      onClick={() =>
                        void run("settle", async () => {
                          if (!base || !owner || !row) return;
                          const sig = await settleDirect(base, owner, row.publicKey);
                          notify("ok", `settled · ${shortKey(sig, 4)}`);
                        })
                      }
                    >
                      Settle now
                    </button>
                  ) : null}

                  {canClose ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy !== null}
                      onClick={() =>
                        void run("close", async () => {
                          if (!base || !owner || !row) return;
                          await closeJob(base, owner, row.publicKey);
                          notify("ok", "job closed · rent reclaimed");
                          setSelected(null);
                        })
                      }
                    >
                      Close job
                    </button>
                  ) : null}
                </div>

                {error ? <p className="notice">{error}</p> : null}
              </div>

              <div className="detail-side">
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <span className="cap">Timeline</span>
                  <div className="tl">
                    {timeline(row.account, escrow?.paid).map((s, i) => (
                      <div
                        key={i}
                        className={`tl-row${s.state === "future" ? " future" : ""}${
                          s.state === "current" ? " now" : ""
                        }`}
                      >
                        <i
                          className={`dot ${
                            s.state === "failed"
                              ? "dot-bad"
                              : s.state === "current"
                                ? "dot-acc"
                                : s.state === "future"
                                  ? "dot-off"
                                  : "dot-ink"
                          }`}
                        />
                        <b style={{ fontWeight: s.state === "current" ? 500 : 400 }}>{s.label}</b>
                        {i === 0 && num(row.account.createdAt) > 0 ? (
                          <time>{timeText(row.account.createdAt).split(", ")[1] ?? ""}</time>
                        ) : null}
                        {i === 2 && num(row.account.claimedAt) > 0 ? (
                          <time>{timeText(row.account.claimedAt).split(", ")[1] ?? ""}</time>
                        ) : null}
                        {i === 3 && num(row.account.submittedAt) > 0 ? (
                          <time>{timeText(row.account.submittedAt).split(", ")[1] ?? ""}</time>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="escrow">
                  <span className="cap">Escrow</span>
                  <b>{solText(row.account.priceLamports)} SOL</b>
                  <span>
                    {escrow === null
                      ? "Closed or not readable."
                      : escrow.paid
                        ? statusKey(row.account.status) === "approved"
                          ? "Paid to the provider."
                          : "Refunded to you."
                        : `Held on Solana until you approve. Open to anyone ${AUTO_APPROVE_SECS / 60} min after the deadline.`}
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Row({
  row,
  now,
  selected,
  paid,
  onSelect,
}: {
  row: JobRow;
  now: number;
  selected: boolean;
  paid?: boolean;
  onSelect: () => void;
}) {
  const job = row.account;
  return (
    <button type="button" className="row" aria-selected={selected} onClick={onSelect}>
      <div className="row-title">
        <b>{labelText(job.modelLabel) || "unlabelled model"}</b>
        <em>
          {shortKey(row.publicKey, 4)} · {countdown(job.deadlineUnix, now)}
        </em>
      </div>
      <span className="row-price">{solText(job.priceLamports)} SOL</span>
      <Pipeline job={job} paid={paid} />
      <StateWord job={job} paid={paid} />
    </button>
  );
}
