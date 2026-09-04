import { useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PROGRAM_ID } from "@inference-market/client";
import { TeeBadge } from "./components/TeeBadge";
import { Wordmark } from "./components/icons";
import { useMarket } from "./hooks/useMarket";
import { Provider } from "./pages/Provider";
import { Requester } from "./pages/Requester";
import { shortKey } from "./lib/format";

type Page = "requester" | "provider";

export default function App() {
  const [page, setPage] = useState<Page>("requester");
  const market = useMarket();

  return (
    <>
      <header className="topbar">
        <span className="wordmark">
          <Wordmark />
          Inference Market
        </span>

        <nav className="nav">
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

        <span className="spacer" />

        <span className="chip chip-program" title={PROGRAM_ID.toBase58()}>
          devnet · {shortKey(PROGRAM_ID)}
        </span>
        <TeeBadge />
        <WalletMultiButton />
      </header>

      {market.teeError ? (
        <div className="shell" style={{ height: "auto", paddingBottom: 0 }}>
          <div className="note note-warn" style={{ gridColumn: "1 / -1" }}>
            The TEE rollup session could not be opened: {market.teeError}{" "}
            <button
              type="button"
              className="btn btn-sm"
              style={{ marginLeft: 8 }}
              onClick={market.reconnectTee}
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {page === "requester" ? <Requester market={market} /> : <Provider market={market} />}
    </>
  );
}
