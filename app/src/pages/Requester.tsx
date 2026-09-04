import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  cancelJobBase,
  closeJob,
  escrowPda,
  finishJob,
  readPrivate,
  settleDirect,
} from "@inference-market/client";
import type { FinishKind } from "@inference-market/client";
import { Composer } from "../components/Composer";
import { ConfirmBar } from "../components/ConfirmBar";
import type { ConfirmChoice } from "../components/ConfirmBar";
import { JobCard } from "../components/JobCard";
import { JobDetail } from "../components/JobDetail";
import type { EscrowView } from "../components/JobDetail";
import { Sealed } from "../components/Sealed";
import { SlideOver } from "../components/SlideOver";
import { RefreshIcon } from "../components/icons";
import { useActionEscrow, TOP_UP_LAMPORTS } from "../hooks/useActionEscrow";
import { useJobs } from "../hooks/useJobs";
import type { Market } from "../hooks/useMarket";
import { useNow } from "../hooks/useNow";
import { useNotify } from "../notify";
import { stagger } from "../motion";
import { LAMPORTS, byteLen, errText, isTerminal, num, shortKey, statusKey } from "../lib/format";

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
  const now = useNow();

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
  // rendered inside a seal; never logged, never sent anywhere.
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
  const pastDeadline = row ? num(row.account.deadlineUnix) * 1000 <= now : false;
  const onErNow = row?.layer === "er";
  const canSettle = Boolean(row && !onErNow && terminal && escrow && !escrow.paid);
  const canClose = Boolean(row && terminal && escrow?.paid);

  const decisions: ConfirmChoice[] = [];
  if (status === "submitted") {
    decisions.push({
      id: "approve",
      label: "Approve and pay",
      question: `Pay the provider ${row ? Number(row.account.priceLamports.toString()) / LAMPORTS : 0} SOL?`,
    });
    decisions.push({
      id: "reject",
      label: "Reject and refund",
      tone: "danger",
      question: "Reject this answer and take the escrow back?",
    });
  }
  if (status === "open") {
    decisions.push({
      id: "cancel",
      label: "Cancel job",
      tone: "danger",
      question: "Cancel this job and refund yourself?",
    });
  }

  const actions = row ? (
    <div style={{ display: "grid", gap: 10 }}>
      {decisions.length ? (
        <ConfirmBar
          choices={decisions}
          busy={busy}
          onRun={(id) => void finish(id as FinishKind)}
        />
      ) : null}

      <div className="actions">
        {!actionEscrow.funded ? (
          <button
            type="button"
            className="btn btn-sm"
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

        {status === "created" ? (
          <button
            type="button"
            className="btn btn-sm btn-danger"
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

        {onErNow && pastDeadline && (status === "open" || status === "claimed") ? (
          <button
            type="button"
            className="btn btn-sm"
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
            className="btn btn-sm btn-primary"
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
            className="btn btn-sm"
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
  ) : null;

  return (
    <div className="page">
      <Composer market={market} onPublished={(job) => setSelectedKey(job.toBase58())} />

      <section>
        <div className="section-head">
          <h2>Your jobs</h2>
          {jobs ? <span className="count">{jobs.length}</span> : null}
          <span className="spacer" />
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
            <h3>No wallet connected</h3>
            <p>Connect one to post a job and watch it move through the rollup.</p>
          </div>
        ) : jobs === null ? (
          <div className="cards">
            {[0, 1, 2].map((i) => (
              <div className="skeleton-card" key={i}>
                <div className="sk" style={{ width: "62%" }} />
                <div className="sk" style={{ width: "38%", height: 9 }} />
                <div className="sk" style={{ height: 3, marginTop: 8 }} />
              </div>
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="empty">
            <h3>Nothing posted yet</h3>
            <p>
              Write a prompt above and publish it. The card appears here and lights up step by step
              as the rollup takes it.
            </p>
          </div>
        ) : (
          <motion.div className="cards" variants={stagger} initial="hidden" animate="show">
            <AnimatePresence mode="popLayout">
              {jobs.map((j) => (
                <JobCard
                  key={j.publicKey.toBase58()}
                  row={j}
                  now={now}
                  selected={j.publicKey.toBase58() === selectedKey}
                  paid={j.publicKey.toBase58() === selectedKey ? escrow?.paid : undefined}
                  onSelect={() => setSelectedKey(j.publicKey.toBase58())}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </section>

      <SlideOver open={Boolean(row)} onClose={() => setSelectedKey(null)} label="Job detail">
        {row ? (
          <JobDetail
            row={row}
            escrow={escrow}
            now={now}
            onClose={() => setSelectedKey(null)}
            actions={actions}
            result={
              output ? (
                <Sealed
                  text={output}
                  caption={`Output · ${byteLen(output).toLocaleString()} bytes`}
                />
              ) : (
                <p className="note">
                  {onErNow
                    ? "No output yet. It unseals here the moment a provider submits, and only for wallets on this job's permission list."
                    : "The private buffers were scrubbed when the job left the rollup."}
                </p>
              )
            }
          />
        ) : null}
      </SlideOver>
    </div>
  );
}
