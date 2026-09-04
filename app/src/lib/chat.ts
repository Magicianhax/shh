import { PROMPT_MAX } from "@inference-market/client";
import { byteLen, capBytes } from "./format";

export type ChatState =
  | "publishing"
  | "open"
  | "claimed"
  | "submitted"
  /** `finishJob` threw. The decision never reached the rollup; retry is manual. */
  | "decision_failed"
  /** `finishJob` landed. The money is moving; this state is never left by polling. */
  | "settling"
  | "settled"
  | "rejected"
  | "failed";

export type Step = { name: string; ms: number | null; done: boolean; failed?: boolean };

export type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  /** Assistant only, base58 of the job account this turn became. */
  job?: string;
  state?: ChatState;
  steps?: Step[];
  error?: string | null;
  provider?: string | null;
  priceLamports?: number;
  /** Settlement signature, once there is one. */
  sig?: string | null;
  answeredMs?: number | null;
  deadlineUnix?: number;
  /**
   * Set before the first approve or reject and never cleared. Auto-approve is
   * gated on this, so a failed decision can never become a signature loop.
   */
  decisionAttempted?: boolean;
  /** Which decision was sent, so a settle retry knows what it is finishing. */
  decision?: "approve" | "reject";
  /** A settle-phase failure, shown inline with a retry that skips `finishJob`. */
  settleError?: string | null;
  /**
   * Consecutive polls that found the job submitted with a zero-length output.
   * A provider may legitimately seal nothing, so the poll gives up after
   * `EMPTY_READ_LIMIT` tries rather than spinning forever.
   */
  emptyReads?: number;
};

export type Conversation = {
  id: string;
  title: string;
  at: number;
  model: string;
  priceLamports: number;
  minutes: number;
  autoApprove: boolean;
  messages: ChatMsg[];
};

export const STEP_NAMES = ["sealing", "delegating", "permissions", "prompt"] as const;

export const freshSteps = (): Step[] =>
  STEP_NAMES.map((name) => ({ name, ms: null, done: false }));

export const PREAMBLE =
  "You are answering inside a private inference marketplace. Reply directly.";

/** Bytes the preamble and its blank line always cost, before any turn. */
export const PREAMBLE_BYTES = byteLen(`${PREAMBLE}\n\n`);

/**
 * The largest draft that can still be published, once the preamble and the
 * "User: " marker are paid for. Shown to the user as the cap, so the counter
 * they watch is the one that actually stops them.
 */
export const DRAFT_MAX = PROMPT_MAX - PREAMBLE_BYTES - byteLen("User: ") - 2;

const STORE_KEY = "im.chat.v1";

export type Store = { convs: Conversation[]; activeId: string | null };

export const emptyStore = (): Store => ({ convs: [], activeId: null });

export const newConversation = (): Conversation => ({
  id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  title: "New chat",
  at: Date.now(),
  model: "claude",
  priceLamports: 10_000_000,
  minutes: 30,
  autoApprove: false,
  messages: [],
});

/**
 * Conversations live in this browser only. The prompt and the answer are the
 * user's own words, already on their screen; nothing here is sent anywhere, and
 * the on-chain buffers are still wiped at approval regardless of what this
 * cache holds.
 */
export function loadStore(): Store {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Store;
    if (!Array.isArray(parsed?.convs)) return emptyStore();
    return { convs: parsed.convs, activeId: parsed.activeId ?? null };
  } catch {
    return emptyStore();
  }
}

export function saveStore(store: Store) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* private mode, quota, or blocked storage: the session still works */
  }
}

/** First line of the first user message, trimmed, as the rail label. */
export const titleFrom = (text: string): string => {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 46 ? `${line.slice(0, 46)}…` : line || "New chat";
};

const turn = (m: ChatMsg) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`;

/** Re-exported so the composer and the prompt builder share one definition. */
export { capBytes };

export type BuiltPrompt = {
  text: string;
  bytes: number;
  /** True when older turns had to be dropped to fit. */
  trimmed: boolean;
};

/**
 * The prompt for one turn: a short preamble, then as much of this conversation
 * as fits in `PROMPT_MAX` bytes, dropping the oldest turns first so the newest
 * context always survives.
 *
 * The result is guaranteed to fit. When even the newest turn alone is too long,
 * that turn is truncated rather than returned oversized, because the caller
 * hands this straight to `publishJob`, which rejects anything over the cap.
 *
 * `trimmed` is reported rather than inferred: the caller cannot tell from the
 * byte count alone, because a trimmed prompt is by definition under the cap.
 */
export function buildPrompt(history: ChatMsg[], next: string): BuiltPrompt {
  const usable = history.filter((m) => m.text.trim().length > 0);
  const head = `${PREAMBLE}\n\n`;

  const compose = (from: number, tailText: string) =>
    head +
    usable.slice(from).map(turn).join("\n\n") +
    (from < usable.length ? "\n\n" : "") +
    `User: ${tailText}`;

  const tail = next.trim();
  let start = 0;
  let out = compose(start, tail);

  while (byteLen(out) > PROMPT_MAX && start < usable.length) {
    start += 1;
    out = compose(start, tail);
  }

  let truncated = false;
  if (byteLen(out) > PROMPT_MAX) {
    // No history left to drop, so the newest turn itself is over budget.
    const room = PROMPT_MAX - byteLen(compose(usable.length, ""));
    out = compose(usable.length, capBytes(tail, Math.max(0, room)));
    truncated = true;
  }

  return { text: out, bytes: byteLen(out), trimmed: start > 0 || truncated };
}

/** In flight from the user's point of view: something is still happening. */
export const isLive = (state?: ChatState): boolean =>
  state === "publishing" || state === "open" || state === "claimed" || state === "settling";

/**
 * Whether the rollup should still be polled for this message.
 *
 * Deliberately narrow. A message being settled is NOT polled: a tick landing
 * mid-decision used to patch it back to "submitted", which re-showed
 * Approve/Reject and let the auto-approve effect fire a second signature.
 * "submitted" is polled only while the output has not arrived yet.
 */
export const EMPTY_READ_LIMIT = 5;

export const isPollable = (m: ChatMsg): boolean =>
  Boolean(
    m.job &&
      (m.state === "open" ||
        m.state === "claimed" ||
        (m.state === "submitted" &&
          m.text.length === 0 &&
          (m.emptyReads ?? 0) < EMPTY_READ_LIMIT)),
  );

/** A submitted turn whose output really is empty, after the poll gave up. */
export const isEmptyAnswer = (m: ChatMsg): boolean =>
  m.state === "submitted" && m.text.length === 0 && (m.emptyReads ?? 0) >= EMPTY_READ_LIMIT;

/** Groups conversations the way the rail shows them. */
export function groupByDay(convs: Conversation[]): { label: string; items: Conversation[] }[] {
  const day = 86_400_000;
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const buckets: Record<string, Conversation[]> = { Today: [], Yesterday: [], Earlier: [] };

  for (const c of [...convs].sort((a, b) => b.at - a.at)) {
    if (c.at >= startOfToday) buckets.Today.push(c);
    else if (c.at >= startOfToday - day) buckets.Yesterday.push(c);
    else buckets.Earlier.push(c);
  }

  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}
