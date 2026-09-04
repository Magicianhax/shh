import { motion } from "framer-motion";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { TeeBadge } from "./TeeBadge";
import { Wordmark } from "./icons";
import { springy } from "../motion";
import { LAMPORTS } from "../lib/format";

export type Page = "requester" | "provider";

const TABS: { id: Page; label: string }[] = [
  { id: "requester", label: "Requester" },
  { id: "provider", label: "Provider" },
];

type Props = {
  page: Page;
  onPage: (p: Page) => void;
  lamports: number | null;
};

/**
 * Brand, the two tabs with an underline that slides between them, the TEE
 * indicator, the devnet balance and the wallet button.
 */
export function TopBar({ page, onPage, lamports }: Props) {
  return (
    <header className="topbar">
      <span className="brand">
        <Wordmark size={26} />
        <span>Inference Market</span>
      </span>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={page === t.id ? "page" : undefined}
            onClick={() => onPage(t.id)}
          >
            {t.label}
            {page === t.id ? (
              <motion.span layoutId="tab-underline" className="tab-underline" transition={springy} />
            ) : null}
          </button>
        ))}
      </nav>

      <span className="spacer" />

      <TeeBadge />

      {lamports !== null ? (
        <span className="chip chip-balance" title="Devnet balance">
          <b>{(lamports / LAMPORTS).toFixed(3)}</b> SOL
        </span>
      ) : null}

      <WalletMultiButton />
    </header>
  );
}
