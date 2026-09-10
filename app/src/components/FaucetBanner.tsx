import { useState } from "react";
import { Connection } from "@solana/web3.js";
import type { PublicKey } from "@solana/web3.js";
import { LAMPORTS, solText } from "../lib/format";
import { useNotify } from "../notify";

type Props = {
  owner: PublicKey | null;
  lamports: number | null;
  onFunded: () => void;
};

/** Below this, a requester cannot post a job: price plus ~0.05 SOL of rent. */
const THRESHOLD_LAMPORTS = 0.05 * LAMPORTS;
const AIRDROP_LAMPORTS = 1 * LAMPORTS;
const AIRDROP_TIMEOUT_MS = 12_000;
const FAUCET_URL = "https://faucet.solana.com";

const timeout = (ms: number) =>
  new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), ms));

const copyAddress = async (owner: PublicKey): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(owner.toBase58());
    return true;
  } catch {
    return false;
  }
};

/**
 * Shown wherever a requester might be about to spend: above the composer and
 * at the top of the jobs list. A rejected airdrop (the common case — the
 * public faucet RPC is rate-limited) is never surfaced as an error; the
 * fallback of opening faucet.solana.com with the address already copied is
 * the normal path, not a failure state.
 */
export function FaucetBanner({ owner, lamports, onFunded }: Props) {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);

  if (!owner || lamports === null || lamports >= THRESHOLD_LAMPORTS) return null;

  const openFaucet = (addressCopied: boolean) => {
    window.open(FAUCET_URL, "_blank", "noopener");
    notify(
      addressCopied ? "ok" : "err",
      addressCopied ? "address copied · paste it at faucet.solana.com" : "open faucet.solana.com and paste your address",
    );
  };

  const getSol = async () => {
    setBusy(true);
    const copied = await copyAddress(owner);
    try {
      const drip = new Connection("https://api.devnet.solana.com", "confirmed");
      const sig = await Promise.race([drip.requestAirdrop(owner, AIRDROP_LAMPORTS), timeout(AIRDROP_TIMEOUT_MS)]);
      await drip.confirmTransaction(sig, "confirmed");
      notify("ok", "1 SOL airdropped · devnet");
      onFunded();
    } catch {
      openFaucet(copied);
    } finally {
      setBusy(false);
    }
  };

  const copyOnly = async () => {
    const ok = await copyAddress(owner);
    notify(ok ? "ok" : "err", ok ? "address copied" : "copy failed");
  };

  return (
    <div className="faucet-banner">
      <div className="faucet-banner-text">
        <b>This wallet holds no devnet SOL.</b>
        <span>
          A message costs the model&rsquo;s price plus about {solText(THRESHOLD_LAMPORTS)} SOL of
          account rent, refunded when the job closes.
        </span>
      </div>
      <div className="faucet-banner-actions">
        <button type="button" className="btn btn-ink" disabled={busy} onClick={() => void getSol()}>
          {busy ? <i className="spin" /> : "Get devnet SOL"}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void copyOnly()}>
          Copy address
        </button>
      </div>
    </div>
  );
}
