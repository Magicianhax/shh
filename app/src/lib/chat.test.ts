import assert from "node:assert/strict";
import test from "node:test";
import { PROMPT_MAX } from "@inference-market/client";
import {
  DRAFT_MAX,
  EMPTY_READ_LIMIT,
  PREAMBLE,
  PREAMBLE_BYTES,
  buildPrompt,
  capBytes,
  isEmptyAnswer,
  isLive,
  isPollable,
  storeKey,
} from "./chat";
import type { ChatMsg } from "./chat";
import { byteLen } from "./format";

const user = (text: string): ChatMsg => ({ id: text, role: "user", text, at: 0 });
const bot = (text: string, extra: Partial<ChatMsg> = {}): ChatMsg => ({
  id: text,
  role: "assistant",
  text,
  at: 0,
  state: "settled",
  ...extra,
});

test("the draft cap leaves room for the preamble and the marker", () => {
  assert.equal(PREAMBLE_BYTES, byteLen(`${PREAMBLE}\n\n`));
  assert.ok(DRAFT_MAX < PROMPT_MAX);
  const draft = "x".repeat(DRAFT_MAX);
  assert.ok(buildPrompt([], draft).bytes <= PROMPT_MAX);
});

test("buildPrompt keeps a short conversation whole and reports no trim", () => {
  const out = buildPrompt([user("hello"), bot("hi")], "again");
  assert.ok(out.text.startsWith(PREAMBLE));
  assert.ok(out.text.includes("User: hello"));
  assert.ok(out.text.includes("Assistant: hi"));
  assert.ok(out.text.endsWith("User: again"));
  assert.equal(out.trimmed, false);
  assert.equal(out.bytes, byteLen(out.text));
});

test("buildPrompt drops the oldest turns first, fits, and reports the trim", () => {
  const big = "a".repeat(1500);
  const history = [user(big), bot(big), user(big), bot(big)];
  const out = buildPrompt(history, "the newest question");

  assert.ok(out.bytes <= PROMPT_MAX, `got ${out.bytes} bytes`);
  assert.ok(out.text.endsWith("User: the newest question"));
  assert.equal(out.trimmed, true, "dropping turns must be reported");
  assert.ok(out.bytes > PROMPT_MAX / 2, "should keep as much as fits");
});

test("buildPrompt truncates a single oversized turn rather than overflowing", () => {
  const out = buildPrompt([], "z".repeat(PROMPT_MAX * 2));
  assert.ok(out.bytes <= PROMPT_MAX, `got ${out.bytes} bytes`);
  assert.ok(out.text.startsWith(PREAMBLE));
  assert.equal(out.trimmed, true);
});

test("buildPrompt fits even with oversized history and an oversized draft", () => {
  const history = [user("q".repeat(PROMPT_MAX)), bot("r".repeat(PROMPT_MAX))];
  const out = buildPrompt(history, "w".repeat(PROMPT_MAX));
  assert.ok(out.bytes <= PROMPT_MAX, `got ${out.bytes} bytes`);
});

test("capBytes never splits a code point", () => {
  const emoji = "😀".repeat(10); // four bytes each
  const cut = capBytes(emoji, 9);
  assert.equal(byteLen(cut), 8);
  assert.equal(cut, "😀😀");
});

test("a message being settled is never polled", () => {
  // The bug this guards: a poll tick during `decide` rewrote the message back to
  // "submitted", which re-showed Approve and let auto-approve fire again.
  for (const state of ["settling", "settled", "rejected", "failed", "decision_failed"] as const) {
    assert.equal(isPollable(bot("x", { state, job: "J" })), false, state);
  }
});

test("only open, claimed, and an empty submitted are polled", () => {
  assert.equal(isPollable(bot("", { state: "open", job: "J" })), true);
  assert.equal(isPollable(bot("", { state: "claimed", job: "J" })), true);
  assert.equal(isPollable(bot("", { state: "submitted", job: "J" })), true);
  assert.equal(isPollable(bot("answer", { state: "submitted", job: "J" })), false);
  assert.equal(isPollable(bot("", { state: "publishing", job: "J" })), false);
  assert.equal(isPollable(bot("", { state: "open" })), false);
});

test("an empty output stops being polled after the read limit", () => {
  const at = (n: number) => bot("", { state: "submitted", job: "J", emptyReads: n });
  assert.equal(isPollable(at(0)), true);
  assert.equal(isPollable(at(EMPTY_READ_LIMIT - 1)), true);
  assert.equal(isPollable(at(EMPTY_READ_LIMIT)), false, "must give up, not spin");
  assert.equal(isPollable(at(EMPTY_READ_LIMIT + 3)), false);
});

test("a genuinely empty answer is reported once the poll gave up", () => {
  assert.equal(isEmptyAnswer(bot("", { state: "submitted", emptyReads: EMPTY_READ_LIMIT })), true);
  // Still polling: not yet an empty answer, just an unread one.
  assert.equal(isEmptyAnswer(bot("", { state: "submitted", emptyReads: 1 })), false);
  assert.equal(isEmptyAnswer(bot("text", { state: "submitted", emptyReads: 9 })), false);
});

test("isLive still reports settling as in flight for the UI", () => {
  assert.equal(isLive("settling"), true);
  assert.equal(isLive("settled"), false);
  assert.equal(isLive("decision_failed"), false);
});

test("the store key is namespaced by wallet, and absent without one", () => {
  const a = "5vJRzKSjPnJ1nHDPfeSVsNu1nkcPuvcSFAqLZ9rD2fB1";
  const b = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  assert.equal(storeKey(a), `im.chat.v2.${a}`);
  assert.notEqual(storeKey(a), storeKey(b));
  assert.equal(storeKey(null), null);
});
