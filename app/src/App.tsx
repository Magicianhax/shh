import { AppNav } from "./components/AppNav";
import { WalletTip } from "./components/WalletTip";
import { useMarket } from "./hooks/useMarket";
import { Chat } from "./pages/Chat";
import { Jobs } from "./pages/Jobs";
import { Landing } from "./pages/Landing";
import { Provider } from "./pages/Provider";
import { useRoute } from "./router";

export default function App() {
  const route = useRoute();
  const market = useMarket();

  // The chat owns its whole viewport, rail included, so it carries no app bar.
  const page =
    route === "/" ? (
      <Landing />
    ) : route === "/chat" ? (
      <Chat market={market} />
    ) : (
      <>
        <AppNav market={market} route={route} />
        {market.teeError ? (
          <div className="page" style={{ paddingBottom: 0 }}>
            <p className="notice">
              rollup session not open: {market.teeError}{" "}
              <button
                type="button"
                className="btn btn-sm"
                style={{ marginLeft: 8, minHeight: 36 }}
                onClick={market.reconnectTee}
              >
                Retry
              </button>
            </p>
          </div>
        ) : null}
        {route === "/jobs" ? <Jobs market={market} /> : <Provider market={market} />}
      </>
    );

  // Above every route, including the landing page: it is advice about the
  // visitor's wallet, so it belongs outside any one page's chrome.
  return (
    <div className={route === "/chat" ? "shell shell-locked" : "shell"}>
      <WalletTip />
      {page}
    </div>
  );
}
