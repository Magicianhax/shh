import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { BASE_URL } from "@inference-market/client";
import { WalletModal } from "./components/WalletModal";

type WalletConnect = {
  open: () => void;
  close: () => void;
  isOpen: boolean;
};

const Ctx = createContext<WalletConnect>({ open: () => {}, close: () => {}, isOpen: false });

/** Opens Shh's own wallet connector from anywhere in the tree. */
export const useWalletConnect = (): WalletConnect => useContext(Ctx);

/**
 * `ConnectionProvider` holds the BASE-layer devnet connection only. The TEE
 * ephemeral-rollup connection is built per wallet inside `useMarket`, because
 * it needs a signed challenge from the connected key.
 *
 * `wallets={[]}`: wallet-adapter 0.15 auto-registers every Wallet Standard
 * wallet the browser announces (Phantom, Solflare, Backpack, Glow, Coinbase,
 * ...), so nothing needs to be hardcoded here. `autoConnect={false}` because
 * Shh asks for an explicit pick through its own connector rather than
 * silently reconnecting to whatever was used last.
 */
export function Wallets({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);

  const open = useCallback(() => {
    trigger.current = document.activeElement as HTMLElement | null;
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    trigger.current?.focus?.();
    trigger.current = null;
  }, []);

  const ctx = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);

  return (
    <ConnectionProvider endpoint={BASE_URL} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={[]} autoConnect={false}>
        <Ctx.Provider value={ctx}>
          {children}
          <WalletModal open={isOpen} onClose={close} />
        </Ctx.Provider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
