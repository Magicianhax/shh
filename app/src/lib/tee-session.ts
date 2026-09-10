import { TEE_URL } from "@inference-market/client";

/**
 * The rollup session token, cached per wallet so a reload does not ask for a
 * fresh signature. The token is what the endpoint authenticates on and it is
 * scoped to one public key, so it is stored under a key that includes both the
 * endpoint and the owner; changing either misses the cache and re-signs.
 *
 * Nothing secret to the chain lives here — the token only grants reads of the
 * accounts this wallet is already a permission member of — but it is still a
 * bearer credential, so it never leaves the browser and is dropped on
 * disconnect.
 */
type Session = { token: string; expiresAt: number };

const PREFIX = "shh.tee.v1";

/** Milliseconds before expiry at which a cached token stops being offered. */
const RENEW_LEAD_MS = 60_000;

/** `setTimeout` truncates a delay past this to 32 bits and fires at once. */
export const MAX_TIMEOUT_MS = 2_147_483_647;

const keyFor = (owner: string) => `${PREFIX}:${TEE_URL}:${owner}`;

/**
 * The SDK returns whatever the server sent, falling back to `Date.now() +
 * SESSION_DURATION`, so the value is milliseconds. A server that answered in
 * seconds would be three orders of magnitude too small; normalise rather than
 * trust one shape, because reading seconds as milliseconds expires the session
 * instantly and reading milliseconds as seconds overflows the renewal timer.
 */
export function toEpochMs(expiresAt: number): number {
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return 0;
  return expiresAt < 1e12 ? expiresAt * 1000 : expiresAt;
}

export function loadSession(owner: string): Session | null {
  try {
    const raw = window.localStorage.getItem(keyFor(owner));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.token !== "string" || !parsed.token) return null;
    const expiresAt = toEpochMs(Number(parsed.expiresAt));
    if (expiresAt - RENEW_LEAD_MS <= Date.now()) return null;
    return { token: parsed.token, expiresAt };
  } catch {
    return null;
  }
}

export function saveSession(owner: string, session: Session): void {
  try {
    window.localStorage.setItem(
      keyFor(owner),
      JSON.stringify({ token: session.token, expiresAt: toEpochMs(session.expiresAt) }),
    );
  } catch {
    /* private mode, or the quota is full; the session simply is not cached */
  }
}

export function clearSession(owner: string): void {
  try {
    window.localStorage.removeItem(keyFor(owner));
  } catch {
    /* nothing to do */
  }
}

/**
 * Delay until the token should be renewed, or null when no timer should run.
 * A session that outlives the 32-bit timer ceiling gets no timer at all: the
 * next page load re-reads the cache and decides then, which is what a 30-day
 * token wants. Returning the raw distance here is what fired the renewal
 * immediately and re-prompted for a signature on a loop.
 */
export function renewDelayMs(expiresAt: number, now = Date.now()): number | null {
  const due = toEpochMs(expiresAt) - RENEW_LEAD_MS - now;
  if (!Number.isFinite(due) || due <= 0) return null;
  return due > MAX_TIMEOUT_MS ? null : due;
}
