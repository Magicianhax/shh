# Batching a message into two signatures

Sending one chat message used to cost seven wallet approvals. It now costs two,
and approving costs one with no separate settle step. No program change, no
redeploy: every change is in `client/src/` and `app/src/`.

## Prompt count

| Phase | Before | After |
|---|---|---|
| `create_job` (base) | 1 | 0 |
| `delegate_job` + `delegate_job_private` (base) | 1 | 0 |
| create + both delegates + action-escrow top-up (base) | — | 1 |
| `init_permissions` (rollup) | 1 | 0 |
| `write_prompt` chunks (rollup) | 1 per chunk | 0 |
| `finalize_prompt` (rollup) | 1 | 0 |
| whole rollup sequence, signed once | — | 1 |
| **send total** | **4 + chunks (7 for a short message)** | **2** |
| approve/reject (rollup) | 1 | 1 |
| `settle_direct` (base) | 1 | 0 |
| **approve total** | **2** | **1** |

A short message produces one 900-byte chunk, so the old path was
create, delegate, permissions, one write, finalize, approve, settle: seven.

## The base transaction

`buildOpenJobTxs` in `client/src/flows.ts` assembles `create_job`, both delegate
instructions and, optionally, the ephemeral-balance top-up, all from
`.instruction()` so no account list is written twice. `openJob` sends the result.

Measured with the default model, an unsigned transaction and a placeholder
blockhash. Both columns are the same number, computed two ways:

| Contents | Instructions | `packedSize` | `serialize({requireAllSignatures:false}).length` |
|---|---|---|---|
| create + delegate x2 + top-up | 4 | 735 | 735 |
| create + delegate x2 | 3 | 679 | 679 |

The limit is 1232, so it is comfortably one transaction and never splits in
practice. `create_job` alone is 366 bytes, the delegate pair 575, the top-up 254.

`packInstructions` still handles a split, in order, and `openJob` sends the plan
through `AnchorProvider.sendAll`, which signs the whole plan with one
`signAllTransactions` call and then sends and confirms each transaction in turn.
A split would therefore still cost one approval, not two.

### One fix worth recording

`Transaction.serialize` throws `Transaction too large` above 1232 bytes instead
of returning a size, which is exactly the case a greedy packer has to measure and
reject. `packedSize` now computes the same number from `serializeMessage()` plus
the signature block, so it never throws. The two unit tests in
`client/src/__tests__/pure.test.ts` cover both the fits-in-one and the splits
cases, including that instruction order survives a split.

## The rollup sequence

`sealPrompt` builds `init_permissions`, every `write_prompt` chunk and
`finalize_prompt` as `Transaction`s sharing one blockhash from the rollup
connection, then signs them all in a single `wallet.signAllTransactions(...)`
call. Phantom and Solflare both implement it.

They are **sent one at a time and each is confirmed before the next**. The
sequence is a dependency chain, not a batch: the permission must exist before the
first write, and the seal must follow every chunk. Batching the signature does
not batch the sending.

`skipPreflight: true` is preserved, for the same reason as before: the TEE
endpoint requires the auth token on simulation as well as send. Error surfacing
is preserved too. The confirm-and-report logic moved into a shared `erConfirm`,
so a failed transaction in a batched sequence reports its signature, its runtime
error and its program logs exactly as the one-at-a-time path did, rather than
Anchor 0.32.1's `Unknown action 'undefined'`. The app's `errText` still redacts
`token=` out of anything that reaches the screen; nothing in the new code puts
the endpoint, prompt bytes or keys into a message.

### When the wallet has no `signAllTransactions`

`erSendAll` checks `typeof wallet.signAllTransactions === "function"` at call
time — the type says it is always present, but the object behind it is whatever
adapter the user connected. When it is missing, the sequence falls back to the
original path: sign, send and confirm one transaction at a time, N approvals.

The fallback is visible in the UI, not silent. `sealPrompt` returns
`mode: "batched" | "sequential"`, and `useChat` renames the second step to
`sealing · per-step signing` when the fallback ran, so the step line reads
`posting ✓ 1.4 s · sealing · per-step signing ✓ 820 ms`.

## Approval settles itself

The top-up rides in the first message's base transaction, so the action escrow at
index 255 is funded from the first message onward. `decide` therefore passes
`scheduleAction = true` and the payout is committed inside the same Solana
transaction as the undelegation.

Nothing about the safety machinery changed:

- `settlePhase` and its manual retry are untouched. It still waits for
  undelegation, polls `Escrow.paid` for up to a minute when an action was
  scheduled, and only then spends a signature on `settle_direct`. In the normal
  flow it now finishes by observation and asks for nothing.
- The "Settle now" affordance is still reachable from `settling` and from
  `decision_failed`, for an unfunded escrow or a scheduled action that did not
  run.
- `decisionAttempted` is still set before the call and never cleared, so a
  decision already on chain is never sent twice, and the `erSig`-landed branch
  still refuses to rewind a message into a re-sendable state.

`useChat` now owns `useActionEscrow` and reads `funded` through a ref, so `send`
and `decide` see the live value. After a top-up confirms, `markFunded` credits
the balance optimistically rather than waiting for the read back, because an
approval that raced the refresh would decline to schedule its payout and cost the
user the extra signature this change exists to remove.

## UI

`STEP_NAMES` went from four narrated steps to the two real ones:

- **posting** — the single Solana transaction.
- **sealing** — the rollup sequence.

Each carries its measured milliseconds. The router wait sits inside the sealing
step's wall clock but is deliberately excluded from `recordStep`, which feeds the
app's rollup-latency figure: waiting for the router to observe delegation is
base-layer propagation, not rollup latency.

The interval that used to poll the router and the permission account to advance
the old four-step display is gone; both phases are now awaited directly, so there
is nothing left to observe from the outside. Pending-message states and all other
copy are unchanged.

## What was verified, and what was not

Verified by running it:

- `tsc -p client --noEmit` clean.
- 26 unit tests pass across `client/src/__tests__/pure.test.ts`,
  `client/src/__tests__/models.test.ts` and `app/src/lib/chat.test.ts`, including
  the two new packing tests.
- Base-transaction size measured offline at 735 bytes, cross-checked against
  `tx.serialize({ requireAllSignatures: false }).length`.
- `npm --workspace app run build` passes, `tsc -b` and the vite bundle both.
- `AnchorProvider.sendAll` read in `node_modules` to confirm it makes exactly one
  `signAllTransactions` call and then sends and confirms sequentially, in order.

Not verified by running it:

- **The browser signature path was not executed.** No wallet was connected and no
  transaction was sent to devnet. That the two prompts are two prompts follows
  from the code and from `sendAll`'s implementation, not from a wallet dialog
  anyone watched.
- `tests/devnet/live-worker.ts` was not run. It needs a provider worker with a
  real model key claiming the job to complete; without one it waits 240 seconds,
  fails, and leaves a delegated job with escrowed lamports on devnet. Worth
  noting for whoever runs it next: it signs with `anchor.Wallet`, which *does*
  implement `signAllTransactions`, so it would exercise the batched rollup path
  rather than the fallback. Nothing currently exercises the fallback end to end.
A note on checking the app's types by hand: `tsc -p app --noEmit` checks nothing,
because `app/tsconfig.json` holds `files: []` and only project references. Use
`tsc -p app/tsconfig.app.json --noEmit`, or the workspace build.
