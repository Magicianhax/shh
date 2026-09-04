import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  MODEL_LABEL_LEN,
  escrowPda,
  providerPda,
  readPrivate,
  registerProvider,
} from "@inference-market/client";
import { JobCard } from "../components/JobCard";
import { JobDetail } from "../components/JobDetail";
import type { EscrowView } from "../components/JobDetail";
import { Sealed } from "../components/Sealed";
import { SlideOver } from "../components/SlideOver";
import { RefreshIcon } from "../components/icons";
import { useJobs } from "../hooks/useJobs";
import type { Market } from "../hooks/useMarket";
import { useNow } from "../hooks/useNow";
import { useNotify } from "../notify";
import { byteLen, errText, labelText, shortKey } from "../lib/format";

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

  return (
    <div className="page">
      <section className="panel">
        <div className="panel-head">
          <h3>Provider account</h3>
        </div>

        {!owner ? (
          <div className="panel-body">
            <div className="empty" style={{ border: 0, padding: "28px 0" }}>
              <h3>No wallet connected</h3>
              <p>Connect the wallet your worker signs with to register it as a provider.</p>
            </div>
          </div>
        ) : account ? (
          <div className="panel-body">
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
                  <span style={{ fontSize: "1.375rem", fontWeight: 600 }}>{account.completed}</span>
                </div>
              </div>
              <div className="fact">
                <span className="label">Rejected</span>
                <div className="value">
                  <span style={{ fontSize: "1.375rem", fontWeight: 600 }}>{account.rejected}</span>
                </div>
              </div>
            </div>
            <p className="sub" style={{ marginTop: 18 }}>
              Counters move when the escrow settles, not when you submit. Run the worker to claim
              open jobs with this key.
            </p>
          </div>
        ) : (
          <form className="panel-body" onSubmit={register}>
            <p className="sub" style={{ marginBottom: 18 }}>
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

      <section>
        <div className="section-head" style={{ marginBottom: 16 }}>
          <h2>Jobs you took</h2>
          <span className="count">{jobs ? jobs.length : "—"}</span>
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
            <p>Connect the worker wallet to see the jobs it claimed.</p>
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
            <h3>Nothing claimed</h3>
            <p>
              Jobs land here once the worker claims them on the rollup, and stay until the requester
              closes them.
            </p>
          </div>
        ) : (
          <div className="cards">
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
          </div>
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
