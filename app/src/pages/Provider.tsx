import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { MODEL_LABEL_LEN, providerPda, registerProvider } from "@inference-market/client";
import { NetworkPanel } from "../components/NetworkPanel";
import { ProviderSetup } from "../components/ProviderSetup";
import { Pipeline, StateWord } from "../components/Pipeline";
import { useJobs } from "../hooks/useJobs";
import type { Market } from "../hooks/useMarket";
import { useNetworkStats } from "../hooks/useNetworkStats";
import { useNow } from "../hooks/useNow";
import { useOpenJobs } from "../hooks/useOpenJobs";
import { useNotify } from "../notify";
import {
  LAMPORTS,
  countdown,
  errText,
  labelText,
  num,
  shortKey,
  solText,
  statusKey,
} from "../lib/format";

type ProviderAccount = { modelLabel: number[]; completed: number; rejected: number } | null;

export function Provider({ market }: { market: Market }) {
  const { base, er, wallet } = market;
  const notify = useNotify();
  const owner = wallet.publicKey ?? null;
  const now = useNow();

  const mine = useCallback(
    (a: any) => Boolean(owner && a.provider.equals(owner)),
    [owner],
  );
  const { jobs } = useJobs(base, er, mine);
  const open = useOpenJobs(er);
  const network = useNetworkStats(er);

  const [account, setAccount] = useState<ProviderAccount>(null);
  const [loaded, setLoaded] = useState(false);
  const [model, setModel] = useState("claude");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  /**
   * Earned is summed from approved jobs still on chain. The `Provider` account
   * stores only the counters, so a job the requester has closed no longer
   * counts; the tile says so rather than implying a lifetime total.
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

  const register = async (e: FormEvent) => {
    e.preventDefault();
    if (!base || !owner || !model.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const sig = await registerProvider(base, owner, model.trim());
      notify("ok", `registered · ${shortKey(sig, 4)}`);
      await loadAccount();
      network.refresh();
    } catch (err) {
      setError(errText(err));
      notify("err", "registration failed");
    } finally {
      setBusy(false);
    }
  };

  const feed = useMemo(() => {
    if (!open.jobs) return null;
    const q = filter.trim().toLowerCase();
    return q
      ? open.jobs.filter((j) => labelText(j.account.modelLabel).toLowerCase().includes(q))
      : open.jobs;
  }, [open.jobs, filter]);

  const labels = useMemo(() => {
    const set = new Set<string>();
    for (const j of open.jobs ?? []) {
      const l = labelText(j.account.modelLabel);
      if (l) set.add(l);
    }
    return [...set].slice(0, 5);
  }, [open.jobs]);

  if (!owner) {
    return (
      <div className="page">
        <div className="page-head">
          <h2>
            Serve inference,
            <br />
            get paid on approval.
          </h2>
        </div>

        <ProviderSetup owner={null} registered={false} claimed={null} />

        <NetworkPanel stats={network} rollupReady={Boolean(er)} owner={owner} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>
          Serve inference,
          <br />
          get paid on approval.
        </h2>
      </div>

      <ProviderSetup
        owner={owner.toBase58()}
        registered={Boolean(account)}
        claimed={jobs === null ? null : jobs.length}
      />

      {!account ? (
        <form className="register" onSubmit={register} style={{ marginBottom: 32 }}>
          <label className="field" style={{ flex: 1 }}>
            <span className="sr">Model label</span>
            <input
              value={model}
              maxLength={MODEL_LABEL_LEN}
              disabled={busy || !base}
              placeholder="claude"
              onChange={(e) => setModel(e.target.value)}
            />
            <span>label</span>
          </label>
          <button type="submit" className="btn btn-ink" disabled={busy || !base || !model.trim()}>
            {busy ? <i className="spin" /> : null}
            Register provider
          </button>
        </form>
      ) : null}

      <NetworkPanel stats={network} rollupReady={Boolean(er)} owner={owner} />

      <div className="tiles" style={{ marginBottom: 28 }}>
        <div className="tile">
          <span className="cap">Earned</span>
          <b>
            {account ? (earned / LAMPORTS).toFixed(3) : "—"}
            {account ? <small>SOL</small> : null}
          </b>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            From approved jobs still on chain.
          </span>
        </div>
        <div className="tile">
          <span className="cap">Completed</span>
          <b>{account ? account.completed : "—"}</b>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Counted when the escrow settles.</span>
        </div>
        <div className="tile">
          <span className="cap">Rejected</span>
          <b>{account ? account.rejected : "—"}</b>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Refunded to the requester.</span>
        </div>
        <div className="tile">
          <span className="cap">Serving</span>
          <b style={{ fontSize: 20 }}>{account ? labelText(account.modelLabel) || "unlabelled" : "—"}</b>
          <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
            {shortKey(owner, 4)}
          </span>
        </div>
      </div>


      {error ? <p className="notice" style={{ marginBottom: 24 }}>{error}</p> : null}

      <div className="page-head" style={{ marginTop: 8 }}>
        <h2 style={{ fontSize: 22 }}>Open jobs</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="pill"
            aria-pressed={filter === ""}
            style={filter === "" ? { background: "var(--solid)", color: "var(--on-solid)" } : undefined}
            onClick={() => setFilter("")}
          >
            all
          </button>
          {labels.map((l) => (
            <button
              key={l}
              type="button"
              className="pill"
              aria-pressed={filter === l}
              style={filter === l ? { background: "var(--solid)", color: "var(--on-solid)" } : undefined}
              onClick={() => setFilter(l)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {open.error ? (
        <p className="notice">{open.error}</p>
      ) : feed === null ? (
        <p className="empty">reading the rollup…</p>
      ) : feed.length === 0 ? (
        <p className="empty">no open jobs right now · new ones appear within a few seconds</p>
      ) : (
        <div className="rows" style={{ marginBottom: 32 }}>
          {feed.slice(0, 12).map((j) => (
            <div key={j.publicKey.toBase58()} className="row" style={{ cursor: "default" }}>
              <div className="row-title">
                <b>{labelText(j.account.modelLabel) || "unlabelled"}</b>
                <em>
                  {shortKey(j.publicKey, 4)} · from {shortKey(j.account.requester, 4)}
                </em>
              </div>
              <span className="row-price">{solText(j.account.priceLamports)} SOL</span>
              <Pipeline job={j.account} />
              <span className="state">{countdown(j.account.deadlineUnix, now)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="page-head" style={{ marginTop: 8 }}>
        <h2 style={{ fontSize: 22 }}>Claimed by you</h2>
        <span style={{ fontSize: 14, color: "var(--muted)" }}>
          {jobs ? `${jobs.length} total` : ""}
        </span>
      </div>

      {jobs === null ? (
        <p className="empty">reading your jobs…</p>
      ) : jobs.length === 0 ? (
        <p className="empty">
          {loaded && !account
            ? "register above, then run the worker with this key"
            : "nothing claimed yet · run the worker to claim from the feed above"}
        </p>
      ) : (
        <div className="rows">
          {jobs.map((j) => (
            <div key={j.publicKey.toBase58()} className="row" style={{ cursor: "default" }}>
              <div className="row-title">
                <b>{labelText(j.account.modelLabel) || "unlabelled"}</b>
                <em>
                  {shortKey(j.publicKey, 4)} · {countdown(j.account.deadlineUnix, now)}
                </em>
              </div>
              <span className="row-price">{solText(j.account.priceLamports)} SOL</span>
              <Pipeline job={j.account} />
              <StateWord job={j.account} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
