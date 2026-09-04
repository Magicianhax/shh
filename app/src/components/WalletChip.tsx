import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS, shortKey } from "../lib/format";
import type { PublicKey } from "@solana/web3.js";

type Props = {
  owner: PublicKey | null;
  lamports: number | null;
};

/**
 * The mono wallet pill from the artboards. `WalletMultiButton` accepts children
 * as its label, so the adapter keeps ownership of connect, copy, change and
 * disconnect while the chip reads `5GD6…hkjV · 6.69 SOL`.
 */
export function WalletChip({ owner, lamports }: Props) {
  const label = owner
    ? `${shortKey(owner)}${lamports !== null ? ` · ${(lamports / LAMPORTS).toFixed(2)} SOL` : ""}`
    : "Connect wallet";

  return <WalletMultiButton>{label}</WalletMultiButton>;
}
