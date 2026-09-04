import { useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { TeeBadge } from "./components/TeeBadge";
import { Wordmark } from "./components/icons";
import { useBalance } from "./hooks/useBalance";
import { useMarket } from "./hooks/useMarket";
import { Provider } from "./pages/Provider";
import { Requester } from "./pages/Requester";
import { LAMPORTS } from "./lib/format";

type Page = "requester" | "provider";

export default function App() {
  const [page, setPage] = useState<Page>("requester");
  const market = useMarket();
  const lamports = useBalance(market.connection, market.wallet.publicKey ?? null);

  return (
    <>
      <header className="hero">
        <div className="hero-inner">
          <div className="hero-id">
            <Wordmark size={40} />
            <div>
              <h1>Inference Market</h1>
              <p>
                Post a prompt, pay on approval, and let the model read it only inside a trusted
                enclave. Solana devnet, MagicBlock TEE rollup.
              </p>
            </div>
          </div>

          <div className="hero-meta">
            <TeeBadge />
            {lamports !== null ? (
              <span className="chip" title="Devnet balance">
                <b>{(lamports / LAMPORTS).toFixed(3)}</b> SOL
              </span>
            ) : null}
            <WalletMultiButton />
          </div>
        </div>

        <nav className="tabs">
          <button
            type="button"
            aria-current={page === "requester" ? "page" : undefined}
            onClick={() => setPage("requester")}
          >
            Requester
          </button>
          <button
            type="button"
            aria-current={page === "provider" ? "page" : undefined}
            onClick={() => setPage("provider")}
          >
            Provider
          </button>
        </nav>
      </header>

      {market.teeError ? (
        <div className="page" style={{ paddingBottom: 0 }}>
          <p className="note note-warn">
            The TEE rollup session could not be opened: {market.teeError}{" "}
            <button
              type="button"
              className="btn btn-sm"
              style={{ marginLeft: 8 }}
              onClick={market.reconnectTee}
            >
              Retry
            </button>
          </p>
        </div>
      ) : null}

      {page === "requester" ? <Requester market={market} /> : <Provider market={market} />}
    </>
  );
}
