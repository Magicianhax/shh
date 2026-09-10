import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_TIMEOUT_MS, renewDelayMs, toEpochMs } from "./tee-session";

const SECOND = 1000;
const DAY = 24 * 60 * 60 * SECOND;

test("an expiry in milliseconds is left alone", () => {
  const ms = Date.now() + 30 * DAY;
  assert.equal(toEpochMs(ms), ms);
});

test("an expiry in seconds is promoted to milliseconds", () => {
  const secs = Math.floor((Date.now() + 30 * DAY) / 1000);
  assert.equal(toEpochMs(secs), secs * 1000);
});

test("a nonsense expiry reads as zero rather than a date", () => {
  assert.equal(toEpochMs(Number.NaN), 0);
  assert.equal(toEpochMs(-1), 0);
});

/**
 * The regression this file exists for. The session lasts 30 days, and the old
 * code multiplied a millisecond expiry by another thousand. `setTimeout`
 * truncates any delay past 2^31-1 to 32 bits and fires it immediately, so the
 * renewal ran at once, re-authenticated, and put the wallet's Sign Message
 * dialog into a loop.
 */
test("a 30-day session schedules no renewal timer at all", () => {
  const now = Date.now();
  assert.equal(renewDelayMs(now + 30 * DAY, now), null);
});

test("any scheduled delay stays inside the 32-bit timer ceiling", () => {
  const now = Date.now();
  for (const days of [1, 7, 20, 24, 24.8, 30, 365]) {
    const due = renewDelayMs(now + days * DAY, now);
    if (due !== null) assert.ok(due <= MAX_TIMEOUT_MS, `${days}d produced ${due}`);
  }
});

test("a session inside the ceiling renews one minute early", () => {
  const now = Date.now();
  const due = renewDelayMs(now + 10 * 60 * SECOND, now);
  assert.equal(due, 9 * 60 * SECOND);
});

test("an expired or nearly expired session asks for no timer", () => {
  const now = Date.now();
  assert.equal(renewDelayMs(now - DAY, now), null);
  assert.equal(renewDelayMs(now + 30 * SECOND, now), null);
});
