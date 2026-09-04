import { PublicKey } from "@solana/web3.js";

/** Anchor decodes a Rust enum as `{ variantName: {} }`. */
export type AnchorEnum = Record<string, unknown>;

export const statusKey = (status: AnchorEnum): string => Object.keys(status)[0] ?? "unknown";

const TERMINAL = new Set(["approved", "rejected", "cancelled", "expired"]);

export const isTerminal = (status: AnchorEnum): boolean => TERMINAL.has(statusKey(status));

export const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const shortKey = (key: PublicKey | string, edge = 4): string => {
  const s = typeof key === "string" ? key : key.toBase58();
  return s.length <= edge * 2 + 1 ? s : `${s.slice(0, edge)}…${s.slice(-edge)}`;
};

export const isUnset = (key: PublicKey): boolean => key.equals(PublicKey.default);

/** Anchor hands back BN for u64/i64; go through the string form, never `toNumber`. */
export const num = (v: { toString(): string }): number => Number(v.toString());

export const LAMPORTS = 1_000_000_000;

export const solText = (lamports: { toString(): string }): string => {
  const sol = num(lamports) / LAMPORTS;
  return sol.toLocaleString(undefined, { maximumFractionDigits: 6 });
};

/** Truncated hex for a 32-byte hash, or a dash when the hash is still all zeros. */
export const hexPreview = (bytes: number[] | Uint8Array, edge = 6): string => {
  const arr = Array.from(bytes);
  if (arr.every((b) => b === 0)) return "—";
  const hex = arr.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, edge)}…${hex.slice(-edge)}`;
};

export const hexFull = (bytes: number[] | Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** Decode the fixed `[u8; 32]` model label back into text. */
export const labelText = (bytes: number[] | Uint8Array): string =>
  new TextDecoder()
    .decode(Uint8Array.from(Array.from(bytes)))
    .replace(/\0+$/, "")
    .trim();

export const timeText = (unix: { toString(): string }): string => {
  const t = num(unix);
  return t > 0 ? new Date(t * 1000).toLocaleString() : "—";
};

/** "in 24m" / "18m ago" — deadlines are the thing an operator scans for. */
export const relTime = (unix: { toString(): string }, now = Date.now()): string => {
  const t = num(unix);
  if (!t) return "—";
  const secs = t * 1000 - now;
  const abs = Math.abs(secs);
  const unit =
    abs < 60_000
      ? `${Math.round(abs / 1000)}s`
      : abs < 3_600_000
        ? `${Math.round(abs / 60_000)}m`
        : abs < 86_400_000
          ? `${Math.round(abs / 3_600_000)}h`
          : `${Math.round(abs / 86_400_000)}d`;
  return secs >= 0 ? `in ${unit}` : `${unit} ago`;
};

export const byteLen = (s: string): number => new TextEncoder().encode(s).length;

/**
 * Trim `s` to at most `max` UTF-8 bytes without splitting a code point.
 * Binary search over code points keeps a 4 KB paste responsive.
 */
export const capBytes = (s: string, max: number): string => {
  if (byteLen(s) <= max) return s;
  const cps = Array.from(s);
  let lo = 0;
  let hi = cps.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (byteLen(cps.slice(0, mid).join("")) <= max) lo = mid;
    else hi = mid - 1;
  }
  return cps.slice(0, lo).join("");
};

/**
 * Turn any thrown value into a short, safe message.
 *
 * ER errors carry the whole RPC error JSON plus program logs, and the TEE
 * endpoint carries the read auth token in its query string. Strip the token
 * before anything reaches the DOM, then cap the length.
 */
export const errText = (e: unknown, max = 300): string => {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/token=[^&\s"')\]]*/gi, "token=[redacted]").slice(0, max);
};

export const explorerTx = (sig: string): string =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

export const explorerAddress = (key: PublicKey | string): string =>
  `https://explorer.solana.com/address/${typeof key === "string" ? key : key.toBase58()}?cluster=devnet`;
