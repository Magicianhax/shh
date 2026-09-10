import { useCallback, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { useDismiss } from "../hooks/useDismiss";
import { useNotify } from "../notify";
import { useWalletConnect } from "../wallet";
import { CopyIcon } from "./icons";
import { LAMPORTS, shortKey } from "../lib/format";

type Props = {
  owner: PublicKey | null;
  lamports: number | null;
};

/**
 * The mono wallet pill from the artboards. Disconnected, it opens Shh's own
 * connector. Connected, it opens a small popover: copy, change wallet,
 * disconnect. Nothing here reaches for a wallet-adapter DOM node — the
 * connector and this popover are the only UI, both on-brand.
 */
export function WalletChip({ owner, lamports }: Props) {
  const { open } = useWalletConnect();
  const { disconnect } = useWallet();
  const notify = useNotify();
  const [menuOpen, setMenuOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setMenuOpen(false), []);
  useDismiss(menuOpen, host, close);

  const label = owner
    ? `${shortKey(owner)}${lamports !== null ? ` · ${(lamports / LAMPORTS).toFixed(2)} SOL` : ""}`
    : "Connect wallet";

  if (!owner) {
    return (
      <button type="button" className="wallet-chip" onClick={open}>
        {label}
      </button>
    );
  }

  const copy = () => {
    void navigator.clipboard.writeText(owner.toBase58()).then(
      () => notify("ok", "address copied"),
      () => notify("err", "copy failed"),
    );
    close();
  };

  return (
    <div ref={host} className="wallet-chip-wrap">
      <button
        type="button"
        className="wallet-chip"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        {label}
      </button>

      {menuOpen ? (
        <div role="menu" className="wallet-popover">
          <button type="button" role="menuitem" className="wallet-popover-item" onClick={copy}>
            <CopyIcon size={14} />
            Copy address
          </button>
          <button
            type="button"
            role="menuitem"
            className="wallet-popover-item"
            onClick={() => {
              close();
              open();
            }}
          >
            Change wallet
          </button>
          <button
            type="button"
            role="menuitem"
            className="wallet-popover-item"
            onClick={() => {
              close();
              void disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}
