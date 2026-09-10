import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { CloseIcon } from "./icons";

/**
 * One line across the very top of the site, before anything else.
 *
 * Phantom and Solflare both simulate and security-scan a transaction before
 * they render the approval screen. On devnet, against a program they have never
 * seen, that took twenty to thirty seconds in testing — long enough for the
 * blockhash to die while the prompt is still opening. Backpack shows the prompt
 * first and signs immediately.
 *
 * Nothing about the transaction differs between them, so this cannot be fixed
 * from here; saying so before someone loses a message to it is the honest move.
 */
const KEY = "shh.wallet-tip.dismissed.v1";
const BACKPACK = "Backpack";

const readDismissed = (): boolean => {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    // Private mode, or site data is blocked. Showing the tip is the safe default.
    return false;
  }
};

export function WalletTip() {
  const { wallet, connected } = useWallet();
  const [dismissed, setDismissed] = useState(readDismissed);

  // Already on the wallet this recommends, so there is nothing to say.
  if (dismissed || (connected && wallet?.adapter.name === BACKPACK)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* the tip simply returns next visit */
    }
  };

  return (
    <div className="tipbar" role="note">
      <p>
        Best with{" "}
        <a href="https://backpack.app" target="_blank" rel="noreferrer">
          Backpack
        </a>
        . Phantom and Solflare are slow to approve here — switch them to devnet first.
      </p>
      <button type="button" className="tipbar-close" aria-label="Dismiss" onClick={dismiss}>
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
