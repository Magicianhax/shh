import { useMemo } from "react";
import type { ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { BASE_URL } from "@inference-market/client";
import "@solana/wallet-adapter-react-ui/styles.css";

/**
 * `ConnectionProvider` holds the BASE-layer devnet connection only. The TEE
 * ephemeral-rollup connection is built per wallet inside `useMarket`, because
 * it needs a signed challenge from the connected key.
 *
 * Phantom and Solflare are listed explicitly: both implement `signMessage`,
 * which the TEE auth token requires.
 */
export function Wallets({ children }: { children: ReactNode }) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ConnectionProvider endpoint={BASE_URL} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
