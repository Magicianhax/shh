import { WalletChip } from "./WalletChip";
import { Mark } from "./icons";
import { Link } from "../router";
import type { Route } from "../router";
import type { Market } from "../hooks/useMarket";
import { useBalance } from "../hooks/useBalance";
import { useTee } from "../hooks/useTee";

type Props = {
  market: Market;
  route: Route;
};

/** The app bar from App.dc.html: brand, Requester/Provider toggle, TEE, wallet. */
export function AppNav({ market, route }: Props) {
  const owner = market.wallet.publicKey ?? null;
  const lamports = useBalance(market.connection, owner);
  const tee = useTee();

  return (
    <header className="appnav">
      <div className="appnav-left">
        <Link to="/" className="brand" style={{ color: "var(--ink)" }}>
          <Mark size={24} />
          <span>Shh.ai</span>
        </Link>
        <nav className="toggle">
          <Link to="/chat" aria-current={route === "/chat" || route === "/jobs" ? "page" : undefined}>
            Requester
          </Link>
          <Link to="/provider" aria-current={route === "/provider" ? "page" : undefined}>
            Provider
          </Link>
        </nav>
      </div>

      <div className="appnav-right">
        <span className="tee" title={tee.detail}>
          <i className={`dot ${tee.live ? "dot-live" : tee.live === false ? "dot-bad" : "dot-wait"}`} />
          <span>{tee.label}</span>
        </span>
        <WalletChip owner={owner} lamports={lamports} />
      </div>
    </header>
  );
}
