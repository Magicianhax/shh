import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Hero } from "./components/Hero";
import { TopBar } from "./components/TopBar";
import type { Page } from "./components/TopBar";
import { useBalance } from "./hooks/useBalance";
import { useMarket } from "./hooks/useMarket";
import { Provider } from "./pages/Provider";
import { Requester } from "./pages/Requester";
import { pageSwap } from "./motion";

export default function App() {
  const [page, setPage] = useState<Page>("requester");
  const market = useMarket();
  const connected = Boolean(market.wallet.publicKey);
  const lamports = useBalance(market.connection, market.wallet.publicKey ?? null);

  return (
    <>
      <TopBar page={page} onPage={setPage} lamports={lamports} />

      {/* The landing state, until a wallet connects. */}
      <AnimatePresence initial={false}>{!connected ? <Hero key="hero" /> : null}</AnimatePresence>

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

      <AnimatePresence mode="wait" initial={false}>
        <motion.main
          key={page}
          variants={pageSwap}
          initial="hidden"
          animate="show"
          exit="exit"
        >
          {page === "requester" ? <Requester market={market} /> : <Provider market={market} />}
        </motion.main>
      </AnimatePresence>
    </>
  );
}
