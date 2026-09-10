# Explicit wallet connector

Replaced the hardcoded, auto-connecting `@solana/wallet-adapter-react-ui` integration with an
on-brand, explicit connector.

## Files changed

- `app/src/wallet.tsx` — `wallets={[]}` (Wallet Standard auto-registration), `autoConnect={false}`,
  dropped `WalletModalProvider` and its stylesheet import. Added a `useWalletConnect()` context
  (`open`, `close`, `isOpen`) and renders `<WalletModal />` inside the provider tree. `open()`
  records `document.activeElement` so focus can return to the trigger on close.
- `app/src/components/WalletModal.tsx` (new) — the connector: backdrop + centered card on desktop,
  bottom sheet under 640px. Lists `useWallet().wallets` split into Installed / Other, each row
  showing the adapter icon, name, and a "Detected"/"Install" badge. A wallet without `signMessage`
  is still listed, marked "no message signing · chat can't open a rollup session". Empty state
  points at phantom.app and solflare.com.
- `app/src/components/WalletChip.tsx` — disconnected state is a plain pill calling `open()`.
  Connected state keeps the existing `5GD6…hkjV · 6.69 SOL` label and adds a popover (Copy address,
  Change wallet, Disconnect) built on the existing `useDismiss` hook.
- `app/src/pages/Chat.tsx` — the `connect` callback now calls `useWalletConnect().open()` instead of
  `document.querySelector(".wallet-adapter-button")?.click()`. Grepped the rest of `app/src` for
  `wallet-adapter`; no other call sites reached for that DOM node.
- `app/src/index.css` — removed the `.wallet-adapter-*` override block, added `.wallet-chip`,
  `.wallet-popover*`, `.wallet-modal*`, `.wallet-row*` in the Calm language (warm off-white surfaces,
  ink/muted/accent tokens, JetBrains Mono for the pill and error text, 999px pills, 14–22px
  surfaces). Entrance/backdrop motion is `opacity`/`transform` only, 160–220ms `var(--ease)`, and the
  new classes are added to the existing `prefers-reduced-motion` disable list.
- `app/package.json` — removed `@solana/wallet-adapter-react-ui`, `-phantom`, `-solflare`; kept
  `-base` and `-react`.

`Landing.tsx` and `AppNav.tsx` needed no changes: Landing's CTA is a plain route `Link`, and AppNav
already renders `WalletChip`, which now carries the new behavior for free.

## Select-then-connect sequencing

`select(name)` only points the provider at an adapter; the adapter itself shows up as `wallet` on a
later render because `WalletProvider` state updates are async. `WalletModal` tracks the picked name
in `pending` state and calls `connect()` from an effect keyed on
`wallet?.adapter.name === pending && !connected`, so the actual connect call fires once the provider
has genuinely swapped in that adapter, not on the click itself. `pending` clears on success (which
also shows the error inline, truncated to 200 chars via `errText`, and closes the modal) and on
error, leaving the row re-clickable.

## Verified

- `tsc -p app --noEmit` — clean.
- `npm --workspace app run build` — passes (pre-existing >500kB chunk-size warning is unrelated to
  this change).
- Dev server (`vite --host 0.0.0.0 --port 5173 --strictPort`) served `200` on `/`.
- Playwright against the running dev server at `#/chat`:
  - Desktop (1440×900): clicking "Connect wallet" opens the modal; this machine's headless browser
    injects no Wallet Standard provider, so the empty state renders (verified via screenshot) with
    the phantom.app/solflare.com links.
  - Close button and `Escape` both close the modal; focus returns to the "Connect wallet" trigger
    button afterward (confirmed via accessibility snapshot, `[active]` on the original button).
  - Mobile (375×800): the same flow renders as a full-width bottom sheet, `document.documentElement`
    reports no horizontal scroll, and `.wallet-chip` measures 44px tall. `.wallet-row`/
    `.wallet-popover-item` are set to 56px/44px min-height in CSS but could not be visually
    confirmed in this run since no wallet was present to populate the list.

## Not verified

A real wallet connection (Phantom/Solflare extension, signature prompt, successful `connect()`)
cannot be exercised headlessly — there is no injected Wallet Standard provider in this environment.
The select-then-connect effect, the inline error path, and the connected-state popover (copy /
change wallet / disconnect) were verified by code review and by confirming their CSS states, not by
driving an actual wallet extension.
