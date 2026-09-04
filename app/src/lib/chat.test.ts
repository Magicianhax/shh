import assert from "node:assert/strict";
import test from "node:test";
import { PROMPT_MAX } from "@inference-market/client";
import {
  DRAFT_MAX,
  PREAMBLE,
  PREAMBLE_BYTES,
  buildPrompt,
  capBytes,
  isLive,
  isPollable,
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
  // A draft exactly at the cap still fits once the preamble is added.
  const draft = "x".repeat(DRAFT_MAX);
  assert.ok(byteLen(buildPrompt([], draft)) <= PROMPT_MAX);
});

test("buildPrompt keeps a short conversation whole", () => {
  const out = buildPrompt([user("hello"), bot("hi")], "again");
  assert.ok(out.startsWith(PREAMBLE));
  assert.ok(out.includes("User: hello"));
  assert.ok(out.includes("Assistant: hi"));
  assert.ok(out.endsWith("User: again"));
});

test("buildPrompt drops the oldest turns first and always fits", () => {
  const big = "a".repeat(1500);
  const history = [user(big), bot(big), user(big), bot(big)];
  const out = buildPrompt(history, "the newest question");

  assert.ok(byteLen(out) <= PROMPT_MAX, `got ${byteLen(out)} bytes`);
  assert.ok(out.endsWith("User: the newest question"));
  // The newest history turn survives, the oldest does not.
  assert.ok(out.includes("Assistant:"));
  assert.ok(byteLen(out) > PROMPT_MAX / 2, "should keep as much as fits");
});

test("buildPrompt truncates a single oversized turn rather than overflowing", () => {
  const out = buildPrompt([], "z".repeat(PROMPT_MAX * 2));
  assert.ok(byteLen(out) <= PROMPT_MAX, `got ${byteLen(out)} bytes`);
  assert.ok(out.startsWith(PREAMBLE));
});

test("buildPrompt fits even with oversized history and an oversized draft", () => {
  const history = [user("q".repeat(PROMPT_MAX)), bot("r".repeat(PROMPT_MAX))];
  const out = buildPrompt(history, "w".repeat(PROMPT_MAX));
  assert.ok(byteLen(out) <= PROMPT_MAX, `got ${byteLen(out)} bytes`);
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
  // Submitted with no output yet: keep polling for the text.
  assert.equal(isPollable(bot("", { state: "submitted", job: "J" })), true);
  // Submitted with output: nothing left to fetch.
  assert.equal(isPollable(bot("answer", { state: "submitted", job: "J" })), false);
  // Publishing has no job account to read yet.
  assert.equal(isPollable(bot("", { state: "publishing", job: "J" })), false);
  // No job key at all.
  assert.equal(isPollable(bot("", { state: "open" })), false);
});

test("isLive still reports settling as in flight for the UI", () => {
  assert.equal(isLive("settling"), true);
  assert.equal(isLive("settled"), false);
  assert.equal(isLive("decision_failed"), false);
});
