import { PROMPT_MAX } from "@inference-market/client";
import { byteLen } from "./format";

export type ChatState =
  | "publishing"
  | "open"
  | "claimed"
  | "submitted"
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

/**
 * The prompt for one turn: a short preamble, then as much of this conversation
 * as fits in `PROMPT_MAX` bytes, dropping the oldest turns first so the newest
 * context always survives.
 */
export function buildPrompt(history: ChatMsg[], next: string): string {
  const usable = history.filter((m) => m.text.trim().length > 0);
  const head = `${PREAMBLE}\n\n`;
  const tail = `User: ${next.trim()}`;

  let start = 0;
  const compose = (from: number) =>
    head + usable.slice(from).map(turn).join("\n\n") + (from < usable.length ? "\n\n" : "") + tail;

  let out = compose(start);
  while (byteLen(out) > PROMPT_MAX && start < usable.length) {
    start += 1;
    out = compose(start);
  }

  // A single turn that still does not fit is cut to the byte budget by the
  // composer's own cap, so this only guards the degenerate case.
  return out;
}

export const contextBytes = (history: ChatMsg[], draft: string): number =>
  byteLen(buildPrompt(history, draft));

export const isLive = (state?: ChatState): boolean =>
  state === "publishing" || state === "open" || state === "claimed" || state === "settling";

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
