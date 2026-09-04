import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  MODEL_LABEL_LEN,
  escrowPda,
  providerPda,
  registerProvider,
} from "@inference-market/client";
import { JobCard } from "../components/JobCard";
import { JobDetail } from "../components/JobDetail";
import type { EscrowView } from "../components/JobDetail";
import { RefreshIcon } from "../components/icons";
import { useJobs } from "../hooks/useJobs";
import type { Market } from "../hooks/useMarket";
import { useNotify } from "../notify";
import { errText, labelText, shortKey } from "../lib/format";

type ProviderAccount = {
  modelLabel: number[];
  completed: number;
  rejected: number;
} | null;

export function Provider({ market }: { market: Market }) {
  const { base, er, wallet } = market;
  const notify = useNotify();
  const owner = wallet.publicKey;

  const mine = useCallback(
    (account: any) => Boolean(owner && account.provider.equals(owner)),
    [owner],
  );
  const { jobs, refresh } = useJobs(base, er, mine);

  const [account, setAccount] = useState<ProviderAccount>(null);
  const [loaded, setLoaded] = useState(false);
  const [model, setModel] = useState("llama-3.1-8b");
  const [busy, setBusy] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [escrow, setEscrow] = useState<EscrowView>(null);

  const row = useMemo(
    () => jobs?.find((j) => j.publicKey.toBase58() === selectedKey) ?? null,
    [jobs, selectedKey],
  );

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

  return (
    <div className="shell">
      <div className="col">
        <section className="panel">
          <div className="panel-head">
            <h2>Provider account</h2>
          </div>

          {!owner ? (
            <div className="empty">
              <h3>Not connected</h3>
              <p>Connect the wallet your worker signs with to register it as a provider.</p>
            </div>
          ) : account ? (
            <>
              <div className="facts">
                <div className="fact">
                  <span className="label">Model</span>
                  <div className="value">
                    <span>{labelText(account.modelLabel) || "unlabelled"}</span>
                  </div>
                </div>
                <div className="fact">
                  <span className="label">Authority</span>
                  <div className="value">
                    <code className="mono">{shortKey(owner, 6)}</code>
                  </div>
                </div>
                <div className="fact">
                  <span className="label">Completed</span>
                  <div className="value">
                    <span>{account.completed}</span>
                  </div>
                </div>
                <div className="fact">
                  <span className="label">Rejected</span>
                  <div className="value">
                    <span>{account.rejected}</span>
                  </div>
                </div>
              </div>
              <div className="section">
                <p className="sub">
                  Counters move when the escrow settles, not when you submit. Run the worker to
                  claim open jobs with this key.
                </p>
              </div>
            </>
          ) : (
            <form className="panel-body" onSubmit={register}>
              <p className="sub" style={{ marginBottom: 14 }}>
                {loaded
                  ? "This wallet is not registered yet. Register it once, then run the worker with the same key."
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
                  className="btn btn-primary btn-wide"
                  disabled={busy || !base || !model.trim()}
                >
                  {busy ? <i className="spin" /> : null}
                  Register provider
                </button>
              </div>
            </form>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Jobs you took</h2>
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
              <p>Connect the worker wallet to see the jobs it claimed.</p>
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
              <h3>Nothing claimed</h3>
              <p>
                Jobs show up here once the worker claims them on the rollup, and stay until the
                requester closes them.
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
              <p className="sub">
                Claiming and submitting happen in the worker, not here. This panel is the public
                record: status, hashes and where the escrow stands.
              </p>
            </div>
          </JobDetail>
        ) : (
          <section className="panel panel-fill">
            <div className="empty">
              <h3>Nothing selected</h3>
              <p>Pick a job to see its status, its hashes and whether the escrow has paid out.</p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
