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

## Addendum: devnet guidance, network badge, faucet flow

1. **Network badge.** `AppNav.tsx` and `Chat.tsx`'s thread head each get a static mono
   `<span className="pill pill-static">Devnet</span>` next to the existing TEE indicator, reusing
   the existing `.pill`/`.pill-static` classes (same look as the composer's `claude`/`0.010 SOL`
   chips). It is display-only, not a control, so it is not a 44px target.
2. **Devnet note in the connect modal.** `WalletModal.tsx` gets a native `<details
   class="wallet-modal-disclosure">` under the intro line, collapsed by default, summary "Wallet
   not on devnet?". Body: Phantom (Settings → Developer Settings → Testnet Mode → Solana Devnet),
   Solflare (Settings → Network → Devnet), and the closing line that Shh only ever talks to devnet.
3. **Faucet banner.** New `app/src/components/FaucetBanner.tsx`, rendered above the composer on
   `#/chat` (wrapped in `.faucet-wrap` to match the 760px thread width) and at the top of `#/jobs`
   (`Jobs.tsx`, right under the page head). Hidden whenever `owner` is null, `lamports` is null, or
   `lamports >= 0.05 SOL`. "Get devnet SOL" copies the address, then races
   `new Connection("https://api.devnet.solana.com", "confirmed").requestAirdrop(...)` against a
   12s timeout; on success it confirms the transaction, toasts, and calls `onFunded` (wired to
   `useBalance`'s new `refresh()`). Any failure — timeout, RPC error, rate limit — is swallowed and
   falls back to opening `https://faucet.solana.com` in a new tab with `noopener`, toasting that the
   address is already on the clipboard. Nothing here surfaces a raw RPC error to the user.
   "Copy address" is a plain secondary action.
4. **Balance refresh.** `useBalance` now returns `{ lamports, refresh }` instead of a bare number:
   it re-reads on mount, every 20s, on `window`'s `focus` event, and on demand via `refresh`. Updated
   both existing call sites (`AppNav.tsx`, `Chat.tsx`) and added a new one in `Jobs.tsx` (which
   previously never read a balance).
5. **Empty-state pointer.** `Chat.tsx`'s empty state gets a second muted mono line, "Solana devnet
   · testing is free", under the existing "connect a wallet to send your first message" line, shown
   only when no wallet is connected.

### Verified (addendum)

- `tsc -p app --noEmit` and `npm --workspace app run build` — clean, after the balance-hook shape
  change propagated to all three call sites.
- Playwright, desktop (1440×900): Devnet chip renders next to "TEE rollup live" in both the chat
  thread head and the app nav; the disclosure expands/collapses and shows the exact Phantom/Solflare
  copy and closing sentence; the empty-state devnet line renders when disconnected.
- Playwright, 375×800: no horizontal scroll on `#/chat`, `#/jobs`, or `#/provider`. The Devnet chip
  and faucet banner buttons were measured via a detached-DOM probe using the shipped CSS classes:
  banner buttons are 44px (the shared `.btn` class), the chip is 32px (informational, not a
  control, matching the app's other static mono chips).
- Found the Devnet chip crowded the app-nav header at 375px (it doesn't collapse like `.tee`'s label
  already does), overlapping the Requester/Provider toggle with the wallet chip. Fixed by hiding
  `.appnav-right .pill-static` at the existing 640px breakpoint, the same treatment already given to
  `.tee span` and `.brand span`. Confirmed fixed by screenshot after the change.
- **Pre-existing, unrelated to this change:** even with the Devnet chip removed, `#/provider` (and
  by the same markup, `#/jobs`) still visually overlaps the Requester/Provider toggle with the
  "Connect wallet" pill at 375px — confirmed by stashing every addendum edit and reproducing the
  same overlap on the wallet-connector-only commit. It does not cause page-level horizontal scroll
  (`document.documentElement.scrollWidth` stays equal to `clientWidth`), so it wasn't caught by the
  scroll check, but it is a real visual defect in `AppNav`'s phone layout that predates both rounds
  of this work. Left unfixed as out of scope; flagging for a follow-up.

### Not verified (addendum)

Same limitation as above: no injected wallet, so the actual airdrop request/confirm path, the
faucet.solana.com fallback tab, and the banner's disappearance after a real balance change were
verified by code review only, not by driving a live wallet.
