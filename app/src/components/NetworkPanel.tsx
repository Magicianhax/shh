import { useMemo } from "react";
import type { PublicKey } from "@solana/web3.js";
import type { NetworkStats } from "../hooks/useNetworkStats";
import { useNotify } from "../notify";
import { labelText, shortKey } from "../lib/format";
import { RefreshIcon } from "./icons";

type Props = {
  stats: NetworkStats;
  /** True once the rollup session is open (`er` exists) — gates the rollup-derived figures. */
  rollupReady: boolean;
  owner: PublicKey | null;
};

const successShare = (completed: number, rejected: number): string => {
  const total = completed + rejected;
  return total === 0 ? "—" : `${Math.round((completed / total) * 100)}%`;
};

/**
 * Network section for the Provider page: who is registered, who is working
 * right now, and the network-wide totals. Sits above the connected wallet's
 * own panel and renders regardless of whether a wallet is connected — only
 * the rollup-derived figures (working now, open jobs) need one.
 */
export function NetworkPanel({ stats, rollupReady, owner }: Props) {
  const notify = useNotify();

  const sorted = useMemo(() => {
    if (!stats.providers) return null;
    return [...stats.providers].sort((a, b) => b.account.completed - a.account.completed);
  }, [stats.providers]);

  const copy = (key: PublicKey) => {
    void navigator.clipboard.writeText(key.toBase58()).then(
      () => notify("ok", "address copied"),
      () => notify("err", "copy failed"),
    );
  };

  const workingNow = rollupReady && stats.working ? stats.working.size : null;
  const openJobs = rollupReady ? stats.openJobs : null;

  return (
    <section style={{ marginBottom: 36 }}>
      <div className="net-head">
        <div>
          <h3>Network</h3>
          <p className="net-sub">Who&rsquo;s registered and working right now.</p>
        </div>
        <button
          type="button"
          className={`net-refresh${stats.refreshing ? " spin" : ""}`}
          onClick={stats.refresh}
          disabled={stats.refreshing}
          aria-label="Refresh network stats"
          title="Refresh"
        >
          <RefreshIcon size={16} />
        </button>
      </div>

      <div className="stat-row" style={{ marginBottom: 18 }}>
        <div className="stat">
          <span className="cap">Providers registered</span>
          <b>{stats.providers ? stats.providers.length : "—"}</b>
        </div>
        <div className="stat">
          <span className="cap">Working now</span>
          <b>{workingNow ?? "—"}</b>
        </div>
        <div className="stat">
          <span className="cap">Open jobs</span>
          <b>{openJobs ?? "—"}</b>
        </div>
        <div className="stat">
          <span className="cap">Jobs settled</span>
          <b>{stats.completed ?? "—"}</b>
        </div>
        <div className="stat">
          <span className="cap">SOL in escrow</span>
          <b>{stats.escrowSol !== null ? stats.escrowSol.toFixed(3) : "—"}</b>
        </div>
      </div>

      {stats.error ? <p className="notice" style={{ marginBottom: 14 }}>{stats.error}</p> : null}

      {!rollupReady ? (
        <p className="net-caveat" style={{ marginBottom: 8 }}>
          Working now and open jobs need a connected wallet: the rollup session opens only after
          signing a read challenge.
        </p>
      ) : stats.rollupError ? (
        <p className="notice" style={{ marginBottom: 14 }}>{stats.rollupError}</p>
      ) : null}

      <p className="net-caveat" style={{ marginBottom: 18 }}>
        The registered label is advisory: claiming a job never checks it against the job&rsquo;s
        model, so a provider&rsquo;s worker actually serves every model in its catalog.
      </p>

      {sorted === null ? (
        <p className="empty">reading the network…</p>
      ) : sorted.length === 0 ? (
        <p className="empty">no providers registered yet</p>
      ) : (
        <div className="ptable">
          <div className="ptable-head" aria-hidden="true">
            <span>Provider</span>
            <span>Label</span>
            <span>Completed</span>
            <span>Rejected</span>
            <span>Success</span>
          </div>
          {sorted.map((p) => {
            const isYou = Boolean(owner && p.account.authority.equals(owner));
            const isLive = Boolean(rollupReady && stats.working?.has(p.account.authority.toBase58()));
            return (
              <div key={p.publicKey.toBase58()} className="prow">
                <div className="prow-cell prow-addr">
                  {isLive ? <span className="dot dot-live" title="working now" /> : null}
                  <button type="button" onClick={() => copy(p.account.authority)}>
                    {shortKey(p.account.authority, 4)}
                  </button>
                  {isYou ? <span className="prow-you">you</span> : null}
                </div>
                <div className="prow-cell">
                  <span className="prow-label-mobile">Label</span>
                  <span className="prow-label">{labelText(p.account.modelLabel) || "unlabelled"}</span>
                </div>
                <div className="prow-cell prow-num">
                  <span className="prow-label-mobile">Completed</span>
                  {p.account.completed}
                </div>
                <div className="prow-cell prow-num">
                  <span className="prow-label-mobile">Rejected</span>
                  {p.account.rejected}
                </div>
                <div className="prow-cell prow-num">
                  <span className="prow-label-mobile">Success</span>
                  {successShare(p.account.completed, p.account.rejected)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
