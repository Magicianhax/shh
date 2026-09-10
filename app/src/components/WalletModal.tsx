import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Wallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import type { WalletName } from "@solana/wallet-adapter-base";
import { CloseIcon } from "./icons";
import { errText } from "../lib/format";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Shh's own wallet connector. `useWallet().wallets` is populated entirely by
 * Wallet Standard discovery (see `wallet.tsx`), so this lists whatever the
 * browser actually announces rather than a hardcoded pair of adapters.
 *
 * `select()` just points the provider at an adapter; the adapter itself only
 * shows up as `wallet` on a later render, so the connect step is fired from
 * an effect once `wallet.adapter.name` catches up with the pending pick.
 */
export function WalletModal({ open, onClose }: Props) {
  const { wallets, wallet, select, connect, connected } = useWallet();
  const [pending, setPending] = useState<WalletName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) cardRef.current?.focus();
    else {
      setPending(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!pending || wallet?.adapter.name !== pending) return;
    if (connected) {
      setPending(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await connect();
        if (cancelled) return;
        setError(null);
        setPending(null);
        onClose();
      } catch (e) {
        if (cancelled) return;
        setPending(null);
        setError(errText(e, 200));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pending, wallet, connected, connect, onClose]);

  const pick = useCallback(
    (name: WalletName) => {
      setError(null);
      setPending(name);
      select(name);
    },
    [select],
  );

  if (!open) return null;

  const installed = wallets.filter((w) => w.readyState === WalletReadyState.Installed);
  const other = wallets.filter(
    (w) => w.readyState === WalletReadyState.Loadable || w.readyState === WalletReadyState.NotDetected,
  );

  const row = (w: Wallet) => {
    const canSign = "signMessage" in w.adapter;
    const busy = pending === w.adapter.name;
    return (
      <button
        key={w.adapter.name}
        type="button"
        className="wallet-row"
        disabled={busy}
        onClick={() => pick(w.adapter.name)}
      >
        <img src={w.adapter.icon} alt="" width={28} height={28} className="wallet-row-icon" />
        <span className="wallet-row-name">
          <b>{w.adapter.name}</b>
          {!canSign ? (
            <em>no message signing · chat can&rsquo;t open a rollup session</em>
          ) : null}
        </span>
        <span className="wallet-row-badge">
          {busy ? "Connecting…" : w.readyState === WalletReadyState.Installed ? "Detected" : "Install"}
        </span>
      </button>
    );
  };

  return (
    <div
      className="wallet-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={cardRef} className="wallet-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="wallet-modal-head">
          <h3 id={titleId}>Connect a wallet</h3>
          <button type="button" className="wallet-modal-close" aria-label="Close" onClick={onClose}>
            <CloseIcon size={14} />
          </button>
        </div>

        <p className="wallet-modal-copy">
          Shh needs a wallet that can sign messages, because the rollup session is opened with a
          signed challenge.
        </p>

        <details className="wallet-modal-disclosure">
          <summary>Wallet not on devnet?</summary>
          <dl>
            <dt>Phantom</dt>
            <dd>
              Settings, then Developer Settings, enable Testnet Mode, choose Solana Devnet.
            </dd>
            <dt>Solflare</dt>
            <dd>Settings, then Network, choose Devnet.</dd>
          </dl>
          <p>Shh only ever talks to devnet, so mainnet funds are never touched.</p>
        </details>

        {wallets.length === 0 ? (
          <p className="empty" style={{ padding: "10px 0 2px" }}>
            no wallet detected · install{" "}
            <a href="https://phantom.app" target="_blank" rel="noreferrer">
              phantom.app
            </a>{" "}
            or{" "}
            <a href="https://solflare.com" target="_blank" rel="noreferrer">
              solflare.com
            </a>
          </p>
        ) : (
          <div className="wallet-list">
            {installed.length ? (
              <div className="wallet-group">
                <h4>Installed</h4>
                {installed.map(row)}
              </div>
            ) : null}
            {other.length ? (
              <div className="wallet-group">
                <h4>Other</h4>
                {other.map(row)}
              </div>
            ) : null}
          </div>
        )}

        {error ? <p className="wallet-modal-error mono">{error}</p> : null}
      </div>
    </div>
  );
}
