import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  MODEL_LABEL_LEN,
  escrowPda,
  providerPda,
  readPrivate,
  registerProvider,
} from "@inference-market/client";
import { CountUp } from "../components/CountUp";
import { JobCard } from "../components/JobCard";
import { JobDetail } from "../components/JobDetail";
import type { EscrowView } from "../components/JobDetail";
import { OpenJobsFeed } from "../components/OpenJobsFeed";
import { Sealed } from "../components/Sealed";
import { SlideOver } from "../components/SlideOver";
import { RefreshIcon } from "../components/icons";
import { useJobs } from "../hooks/useJobs";
import type { Market } from "../hooks/useMarket";
import { useNow } from "../hooks/useNow";
import { useOpenJobs } from "../hooks/useOpenJobs";
import { useNotify } from "../notify";
import { stagger } from "../motion";
import { LAMPORTS, byteLen, errText, labelText, num, shortKey, statusKey } from "../lib/format";

type ProviderAccount = {
  modelLabel: number[];
  completed: number;
  rejected: number;
} | null;

export function Provider({ market }: { market: Market }) {
  const { base, er, wallet } = market;
  const notify = useNotify();
  const owner = wallet.publicKey;
  const now = useNow();

  const mine = useCallback(
    (account: any) => Boolean(owner && account.provider.equals(owner)),
    [owner],
  );
  const { jobs, refresh } = useJobs(base, er, mine);
  const open = useOpenJobs(er);

  const [account, setAccount] = useState<ProviderAccount>(null);
  const [loaded, setLoaded] = useState(false);
  const [model, setModel] = useState("llama-3.1-8b");
  const [busy, setBusy] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [escrow, setEscrow] = useState<EscrowView>(null);
  const [output, setOutput] = useState<string | null>(null);

  const row = useMemo(
    () => jobs?.find((j) => j.publicKey.toBase58() === selectedKey) ?? null,
    [jobs, selectedKey],
  );

  /**
   * What this key has earned from the jobs still on chain. `Provider` stores
   * only the counters, so the total is summed from approved jobs; a job the
   * requester has closed no longer counts, which the note under the tile says.
   */
  const earned = useMemo(() => {
    if (!jobs) return 0;
    return jobs
      .filter((j) => statusKey(j.account.status) === "approved")
      .reduce((sum, j) => sum + num(j.account.priceLamports), 0);
  }, [jobs]);

  const loadAccount = useCallback(async () => {
    if (!base || !owner) {
      setAccount(null);
      setLoaded(false);
      return;
    }
    try {
      setAccount(await base.account.provider.fetchNullable(providerPda(owner)));
    } catch {
      setAccount(null);
    } finally {
      setLoaded(true);
    }
  }, [base, owner]);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  useEffect(() => {
    if (!base || !row) {
      setEscrow(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const e = await base.account.escrow.fetchNullable(escrowPda(row.publicKey));
        if (!cancelled) setEscrow(e);
      } catch {
        if (!cancelled) setEscrow(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, row, jobs]);

  // The provider is on the job's permission list too, so it can read back what
  // its own worker sealed. Rendered behind the same seal, never logged.
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

  const register = async (e: FormEvent) => {
    e.preventDefault();
    if (!base || !owner || !model.trim()) return;
    setBusy(true);
    try {
      const sig = await registerProvider(base, owner, model.trim());
      notify("ok", "Provider registered", `Signature ${shortKey(sig, 8)}`);
      await loadAccount();
    } catch (err) {
      notify("err", "Registration failed", errText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!owner) {
    return (
      <div className="page">
        <div className="empty">
          <h3>No wallet connected</h3>
          <p>Connect the wallet your worker signs with to register it and watch its jobs.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {account ? (
        <div className="stats">
          <div className="stat stat-accent">
            <span className="label">Earned</span>
            <div className="stat-value">
              <CountUp value={earned / LAMPORTS} decimals={3} />
              <small>SOL</small>
            </div>
            <p className="stat-note">From approved jobs still on chain.</p>
          </div>
          <div className="stat">
            <span className="label">Completed</span>
            <div className="stat-value">
              <CountUp value={account.completed} />
            </div>
            <p className="stat-note">Counted when the escrow settles.</p>
          </div>
          <div className="stat">
            <span className="label">Rejected</span>
            <div className="stat-value">
              <CountUp value={account.rejected} />
            </div>
            <p className="stat-note">Refunded to the requester.</p>
          </div>
          <div className="stat">
            <span className="label">Serving</span>
            <div className="stat-value" style={{ fontSize: "var(--t-xl)" }}>
              {labelText(account.modelLabel) || "unlabelled"}
            </div>
            <p className="stat-note">Authority {shortKey(owner, 4)}</p>
          </div>
        </div>
      ) : (
        <form className="panel" onSubmit={register}>
          <div className="panel-head">
            <h3>Register this wallet as a provider</h3>
          </div>
          <div className="panel-body">
            <p className="sub" style={{ marginBottom: 16 }}>
              {loaded
                ? "Register once, then run the worker with the same key. It claims open jobs, answers them inside the enclave and seals the output."
                : "Reading the provider account…"}
            </p>
            <div className="field">
              <label className="label" htmlFor="provider-model">
                Model you serve
              </label>
              <input
                id="provider-model"
                value={model}
                maxLength={MODEL_LABEL_LEN}
                disabled={busy || !base}
                onChange={(e) => setModel(e.target.value)}
                placeholder="llama-3.1-8b"
              />
            </div>
            <div className="field">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || !base || !model.trim()}
              >
                {busy ? <i className="spin" /> : null}
                Register provider
              </button>
            </div>
          </div>
        </form>
      )}

      <OpenJobsFeed jobs={open.jobs} now={now} error={open.error} />

      <section>
        <div className="section-head">
          <h2>Jobs you took</h2>
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

        {jobs === null ? (
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
            <h3>Nothing claimed</h3>
            <p>
              Jobs land here once the worker claims one from the feed above, and stay until the
              requester closes them.
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
            result={
              output ? (
                <Sealed
                  text={output}
                  caption={`Output · ${byteLen(output).toLocaleString()} bytes`}
                />
              ) : (
                <p className="note">
                  Claiming and submitting happen in the worker. What it sealed shows up here while
                  the job is still on the rollup.
                </p>
              )
            }
          />
        ) : null}
      </SlideOver>
    </div>
  );
}
