# Network stats and provider table on the Provider page

## What was built

A "Network" section on `#/provider`, above the connected wallet's own panel
(`app/src/pages/Provider.tsx`). It renders whether or not a wallet is
connected — only its rollup-derived figures need one.

- `app/src/hooks/useNetworkStats.ts` — the data layer.
- `app/src/components/NetworkPanel.tsx` — the stat row + provider table + caveats.
- `app/src/components/icons.tsx` — added `RefreshIcon`.
- `app/src/index.css` — `.net-*`, `.stat*`, `.ptable*`, `.prow*` rules, plus
  tablet/phone responsive overrides and a reduced-motion entry for the
  refresh spinner.
- `app/src/pages/Provider.tsx` — mounts `NetworkPanel`, calls `network.refresh()`
  after a successful `register_provider`.

## Every figure and the query behind it

| Tile / column | Source | Needs a wallet? |
|---|---|---|
| Providers registered | `readOnlyBase.account.provider.all()` — count of rows | No |
| Jobs settled | Same `provider.all()` rows, `Σ completed` | No |
| (rejected, summed but not tiled) | Same rows, `Σ rejected` | No |
| SOL in escrow | `readOnlyBase.account.escrow.all()`, `Σ amount` where `paid === false` | No |
| Working now | `er.account.job.all()`, distinct `provider` on rows with status `claimed` | **Yes** |
| Open jobs | Same `job.all()` call, count of rows with status `open` | **Yes** |
| Provider table rows | The same `provider.all()` rows, sorted by `completed` desc | No |
| Live dot per row | `provider` pubkey in the "working now" set above | **Yes** |
| "you" marker | Row's `authority` equals the connected wallet's public key | Only meaningful once connected |
| Success % | `completed / (completed + rejected)`, em dash when both are 0 | No |

`readOnlyBase` is a second, throwaway `AnchorProvider` built from
`baseConnection()` in `useNetworkStats` with a stub wallet object
(`{ publicKey: PublicKey.default, signTransaction, signAllTransactions }`,
all rejecting) — it is never asked to sign, only to satisfy `AnchorProvider`'s
constructor shape, so `provider.all()` / `escrow.all()` work with no wallet
connected at all. `anchor.Wallet` (the concrete Node class) is not used: it is
absent from `@coral-xyz/anchor`'s browser bundle and broke the Vite build the
first time around, so a plain object stands in — it only needs to satisfy the
constructor's structural `Wallet` interface, not that class.

The rollup figures come from the `er` program already carried on `market.er`,
which only exists once the wallet has signed the TEE read challenge
(`useMarket`'s `authedTeeConnection`). Until then `useNetworkStats` returns
`null` for `openJobs` and `working`, `NetworkPanel` renders both as an em dash,
and prints one muted line explaining why.

No historical payout total is shown — `Escrow` accounts close on settlement,
so a lifetime SOL-paid figure is not recoverable from the base layer without
an indexer, matching the brief.

## Refresh behavior

`useNetworkStats` fetches once on mount, again on `window` `focus`, and via
`refresh()` — wired to the panel's refresh button and to a successful
`register_provider` in `Provider.tsx`. No `setInterval` polling loop; the
existing `useJobs`/`useOpenJobs` hooks keep their own 8s polling unchanged.

## Caveats shown in the UI (muted copy, not tooltips)

1. "The registered label is advisory: claiming a job never checks it against
   the job's model, so a provider's worker actually serves every model in its
   catalog." — always shown, sourced from `claim_job` in the program never
   comparing `Job.model_label` to `Provider.model_label`.
2. "Working now and open jobs need a connected wallet: the rollup session
   opens only after signing a read challenge." — shown only while
   `market.er` is `null`.

## Responsive

Provider rows use the same grid-to-stacked-card pattern as the existing jobs
list: a 5-column grid down to 641px, then `.prow` collapses to one column
with inline `LABEL / COMPLETED / REJECTED / SUCCESS` labels per field
(`.ptable-head` hides) below 640px. The stat row goes 5 → 3 → 2 columns across
desktop → tablet → phone. The address-copy button keeps a 44px hit target via
padding-by-negative-margin so the visible mono text doesn't grow.

## Verified

- `node node_modules/typescript/bin/tsc -p app --noEmit` — clean.
- `npm --workspace app run build` — passes (`tsc -b` then `vite build`).
- Visual check via a short-lived `vite` dev server + Playwright, disconnected
  wallet state only (a wallet cannot be connected headlessly):
  - 1440px: stat row, caveats, and the 7-row provider table (real devnet
    data — sorted by `completed` desc, correct success %, em dash for two
    providers with no finished jobs) render correctly; zero console errors.
  - 375px: no horizontal scroll (`scrollWidth` 360 ≤ `innerWidth` 375),
    stat row at 2 columns, provider rows stacked into cards with inline
    field labels.
  - 1440px also re-checked for horizontal scroll (`scrollWidth` 1425 ≤
    `innerWidth` 1440).
- The connected-wallet path (working-now count, open-jobs count, live dots,
  the "you" marker, and `network.refresh()` firing after
  `register_provider`) was verified by reading the code, not by connecting a
  real wallet — that requires a browser extension this environment can't
  drive.

## Known collision during this work

Mid-task, `npm --workspace app run build` failed in `app/src/hooks/useChat.ts`
with names (`createJob`, `permissionPda`, `publishJob`) missing from
`client/src/flows.ts`. That was a concurrent, unrelated in-progress edit by
another agent working the same tree (`useChat.ts`, `useActionEscrow.ts`,
`client/src/flows.ts`, `client/src/__tests__/pure.test.ts`, `app/src/lib/chat.ts`,
`app/src/pages/Chat.tsx`), not this change — confirmed by `git diff --stat`
before starting the build and by the fact the only real error once that
landed was in this task's own `useNetworkStats.ts` (the `anchor.Wallet` type
mismatch, since fixed). Only `app/src/components/icons.tsx`,
`app/src/index.css`, `app/src/pages/Provider.tsx`,
`app/src/components/NetworkPanel.tsx`, and `app/src/hooks/useNetworkStats.ts`
are part of this change; the commit stages only those five files.
