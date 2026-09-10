# Dark theme

Shh ships two themes. Light is the Calm design, unchanged. Dark is a night
ground built for the same product, not an inversion of the light one.

Everything below is authored in `app/src/index.css`. There is no raw `oklch()`
literal anywhere else in the app: the three theme blocks at the top of that
file are the only place a colour is spelled out.

## What had to change before dark was possible

The light sheet carried roughly 73 raw `oklch()` literals outside its token
block, plus 7 more inline in `Message.tsx`, `PillMenu.tsx`, `Landing.tsx` and
`Provider.tsx`. All of them are now tokens. Lifting them exposed the real
problem, which is that light draws three different roles with the same
near-black and dark needs them to part company:

| role | what uses it | light | dark |
|---|---|---|---|
| `--ink` | text, the brand mark, a completed pipeline segment | `oklch(22% 0.012 60)` | `oklch(94.5% 0.006 80)` |
| `--solid` | primary button, wallet pill, provider filter chip | `oklch(22% 0.012 60)` | `oklch(78% 0.016 85)` |
| `--deep` | the ledger's view, the sealed card, the trust gap | `oklch(22% 0.012 60)` | `oklch(13.5% 0.008 80)` |

Three more roles were split for the same reason. `--band` is a container that
holds raised cards, and `--tab-on` is the on state of a tab inside a track;
both sit on the far side of the canvas from their children, so neither can
ride the surface ladder, which runs the other way in dark. `--toast-bg` was
split from `--ink` so a dark-mode toast is a raised graphite card rather than
a bright stone flash in the corner of the screen.

Roles the light set simply lacked, now named: `--ink-3` and `--muted-2` (two
text steps that existed only as literals), `--hair-0` (the softest rule),
`--acc-hover`, `--acc-link-hover`, `--acc-quiet`, `--acc-edge`,
`--acc-edge-soft`, `--on-acc`, `--on-solid`, `--bad-soft`, `--bad-ink`,
`--knob`, and the ten `--sh-*` / `--scrim*` depth tokens.

## The four inverted elements

### The hero: "What Solana sees" beside the conversation

The dark panel is the public ledger and the paper panel is the sealed
exchange. In dark the conversation becomes the raised sheet (`--s1`, 23%) and
the ledger goes *below* the canvas rather than above it (`--deep`, 13.5%, on a
19.5% ground), with a lit rim at `--deep-edge` (24%) so the well has an edge.

The reasoning: the ledger panel is the darker of the two in both themes. If
dark had flipped which side was deeper, the metaphor would have mirrored and
the reader would have had to relearn it. Keeping `--deep` as the deepest thing
on the page in both themes means one side is always a void and the other is
always a lit sheet, and the two worlds stay two worlds. Separation is 6.0
OKLab lightness points between the well and the canvas, and 9.5 between the
well and the conversation panel.

### The landing: "Sealed in the rollup" opposite "Visible on Solana"

Same tokens, and deliberately so. Across its three appearances the dark panel
means the ledger's alien view, then the sealed rollup, then the unverifiable
gap. Those look like different meanings, but the common thread is that the
dark panel is always the counterweight to the warm legible paper beside it.
One token serves all three, and the pairing reads the same way in both themes.

### The trust section: "Still trust, not proof" opposite "Enforced on chain"

`--deep` again, with `--on-deep-2` for the list items and `--acc-on-deep` for
the heading and the bullets. Nothing special beyond the shared decision above.

### Primary buttons and the wallet pill

These are near-black on light and get their authority from maximum contrast
against the page. Turning them white in dark would make every call to action a
lamp, and there are two of them side by side in the chat rail.

They become warm stone instead: `--solid` at `oklch(78% 0.016 85)` with
`--on-solid` at 17%. At pill scale that reads as the one solid object on the
page without glare, and it stays clearly distinct from the sage accent button
that sits next to it in the hero. Hover lightens in both themes, 22% to 28% in
light and 78% to 84% in dark, so the gesture is the same either way.

### The Sealed reveal

Blurring bright text on a dark ground produces a glow, which reads as
*something lit* rather than *something withheld*. Three changes fix that,
each token-driven so light is untouched:

- `--seal-bg` recesses the block into the `--deep` family (14%), below the
  canvas, so it sits behind the seam rather than on the page.
- `--seal-rim` draws an inset hairline in dark and is `none` in light.
- `--seal-dim` holds the blurred text at 0.62 opacity in dark and 1 in light,
  and the reveal restores it to 1 alongside dropping the blur.

The reveal therefore changes two things at once in dark, brightness and
focus, which makes the moment stronger than it is in light rather than weaker.

## Mechanics

- An inline script in `app/index.html` resolves the theme and writes
  `data-theme` on `<html>` before first paint. A stored choice wins; anything
  other than `"light"` or `"dark"` in storage counts as unset and the OS
  preference decides. A dark-preferring visitor never sees a white flash.
- `useTheme` (`app/src/hooks/useTheme.ts`) owns changes, persists to
  `localStorage` under `shh-theme`, keeps `<meta name="theme-color">` in step,
  and follows the OS while no choice is stored.
- `color-scheme` is set in both blocks, so scrollbars, form controls and the
  browser's own chrome follow.
- The dark values appear twice: under `[data-theme="dark"]` and, for the case
  where the boot script never ran, under
  `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`.
  The attribute wins in both directions, so the toggle always beats the OS.
- The swap itself does not animate. `.theme-swap` suspends every transition
  for the two frames the repaint needs, otherwise every hover and focus
  transition in the sheet would cross-fade at once and the page would smear.
  `prefers-reduced-motion` is untouched and still disables everything.
- The toggle is in the landing nav, the app bar, and the chat rail head. It is
  built like `.help`: a 22px mark with the 44px target laid over it by a
  pseudo-element, so it does not make any of those bars taller. It carries
  `aria-pressed` and an `sr-only` "Dark theme" label, and the mark shows the
  theme that is on, so the icon and the pressed state never disagree.

## Token table

| token | light | dark |
|---|---|---|
| `--canvas` | `oklch(98.2% 0.006 80)` | `oklch(19.5% 0.009 80)` |
| `--s1` | `oklch(99.4% 0.004 80)` | `oklch(23% 0.009 80)` |
| `--s2` | `oklch(97% 0.008 80)` | `oklch(26% 0.009 80)` |
| `--s3` | `oklch(96.5% 0.012 80)` | `oklch(28.5% 0.01 80)` |
| `--s4` | `oklch(95% 0.008 80)` | `oklch(31.5% 0.01 80)` |
| `--band` | `oklch(96.5% 0.012 80)` | `oklch(16.5% 0.009 80)` |
| `--tab-on` | `oklch(99.4% 0.004 80)` | `oklch(38% 0.011 80)` |
| `--ink` | `oklch(22% 0.012 60)` | `oklch(94.5% 0.006 80)` |
| `--ink-2` | `oklch(42% 0.012 60)` | `oklch(81% 0.008 80)` |
| `--ink-3` | `oklch(45% 0.012 60)` | `oklch(77% 0.008 80)` |
| `--muted` | `oklch(50% 0.012 60)` | `oklch(71% 0.009 80)` |
| `--muted-2` | `oklch(55% 0.012 60)` | `oklch(67% 0.009 80)` |
| `--faint` | `oklch(60% 0.01 60)` | `oklch(62% 0.009 80)` |
| `--hair-0` | `oklch(94% 0.008 80)` | `oklch(27% 0.007 80)` |
| `--hair` | `oklch(92% 0.01 80)` | `oklch(29.5% 0.008 80)` |
| `--hair-2` | `oklch(91% 0.01 80)` | `oklch(31.5% 0.008 80)` |
| `--hair-3` | `oklch(90% 0.01 80)` | `oklch(34% 0.009 80)` |
| `--hair-4` | `oklch(88% 0.01 80)` | `oklch(38% 0.009 80)` |
| `--acc` | `oklch(58% 0.09 175)` | `oklch(72% 0.105 175)` |
| `--acc-hover` | `oklch(54% 0.09 175)` | `oklch(79% 0.105 175)` |
| `--on-acc` | `oklch(99% 0.005 80)` | `oklch(18% 0.02 175)` |
| `--acc-deep` | `oklch(45% 0.07 175)` | `oklch(79% 0.075 175)` |
| `--acc-link` | `oklch(40% 0.07 175)` | `oklch(81% 0.08 175)` |
| `--acc-link-hover` | `oklch(32% 0.08 175)` | `oklch(89% 0.06 175)` |
| `--acc-soft` | `oklch(93% 0.035 175)` | `oklch(31% 0.05 175)` |
| `--acc-quiet` | `oklch(50% 0.04 175)` | `oklch(67% 0.05 175)` |
| `--acc-edge` | `oklch(80% 0.04 175)` | `oklch(50% 0.07 175)` |
| `--acc-edge-soft` | `oklch(85% 0.03 175)` | `oklch(42% 0.05 175)` |
| `--solid` | `oklch(22% 0.012 60)` | `oklch(78% 0.016 85)` |
| `--solid-hover` | `oklch(28% 0.012 60)` | `oklch(84% 0.016 85)` |
| `--on-solid` | `oklch(98% 0.006 80)` | `oklch(17% 0.01 80)` |
| `--deep` | `oklch(22% 0.012 60)` | `oklch(13.5% 0.008 80)` |
| `--deep-edge` | `oklch(22% 0.012 60)` | `oklch(24% 0.008 80)` |
| `--on-deep` | `oklch(92% 0.006 80)` | `oklch(89% 0.006 80)` |
| `--on-deep-2` | `oklch(82% 0.008 80)` | `oklch(78% 0.007 80)` |
| `--on-deep-muted` | `oklch(62% 0.01 60)` | `oklch(66% 0.008 80)` |
| `--hair-deep` | `oklch(32% 0.012 60)` | `oklch(22% 0.008 80)` |
| `--acc-on-deep` | `oklch(70% 0.06 175)` | `oklch(75% 0.075 175)` |
| `--acc-on-deep-hi` | `oklch(80% 0.05 175)` | `oklch(83% 0.06 175)` |
| `--live-on-deep` | `oklch(70% 0.12 160)` | `oklch(74% 0.13 160)` |
| `--seal-bg` | `oklch(97% 0.008 80)` | `oklch(14% 0.008 80)` |
| `--seal-rim` | `none` | `inset 0 0 0 1px oklch(25% 0.009 80)` |
| `--seal-dim` | `1` | `0.62` |
| `--live` | `oklch(62% 0.13 160)` | `oklch(72% 0.13 160)` |
| `--wait` | `oklch(75% 0.05 80)` | `oklch(78% 0.06 85)` |
| `--bad` | `oklch(55% 0.16 25)` | `oklch(71% 0.145 25)` |
| `--bad-soft` | `oklch(96% 0.03 25)` | `oklch(29% 0.05 25)` |
| `--bad-ink` | `oklch(38% 0.14 25)` | `oklch(87% 0.08 25)` |
| `--toast-bg` | `oklch(22% 0.012 60)` | `oklch(30% 0.011 80)` |
| `--toast-ink` | `oklch(97% 0.006 80)` | `oklch(93% 0.006 80)` |
| `--toast-bad-bg` | `oklch(30% 0.08 25)` | `oklch(34% 0.09 25)` |
| `--knob` | `oklch(99% 0 0)` | `oklch(93% 0.006 80)` |
| `--sh-knob` | `0 1px 2px oklch(0% 0 0 / 0.15)` | `0 1px 2px oklch(0% 0 0 / 0.5)` |
| `--sh-toggle` | `0 1px 2px oklch(0% 0 0 / 0.06)` | `0 1px 2px oklch(0% 0 0 / 0.4)` |
| `--sh-card` | `0 1px 0 oklch(100% 0 0) inset, 0 30px 60px -40px oklch(40% 0.03 175)` | `0 1px 0 oklch(30% 0.008 80) inset, 0 30px 60px -34px oklch(0% 0 0 / 0.85)` |
| `--sh-composer` | `0 20px 40px -30px oklch(40% 0.03 175)` | `0 20px 40px -26px oklch(0% 0 0 / 0.8)` |
| `--sh-pop` | `0 18px 40px -26px oklch(40% 0.03 175)` | `0 18px 40px -22px oklch(0% 0 0 / 0.85)` |
| `--sh-row` | `0 12px 30px -24px oklch(40% 0.03 175)` | `0 12px 30px -20px oklch(0% 0 0 / 0.7)` |
| `--sh-toast` | `0 20px 40px -28px oklch(0% 0 0 / 0.8)` | `0 20px 40px -24px oklch(0% 0 0 / 0.9)` |
| `--sh-modal` | `0 30px 60px -30px oklch(0% 0 0 / 0.5)` | `0 30px 60px -26px oklch(0% 0 0 / 0.9)` |
| `--sh-rail` | `0 0 60px -20px oklch(0% 0 0 / 0.35)` | `0 0 60px -16px oklch(0% 0 0 / 0.75)` |
| `--scrim` | `oklch(22% 0.012 60 / 0.3)` | `oklch(0% 0 0 / 0.55)` |
| `--scrim-modal` | `oklch(22% 0.012 60 / 0.42)` | `oklch(0% 0 0 / 0.62)` |

Type, easing and geometry tokens are the same in both themes.

## Measured contrast

WCAG 2.1 ratios, computed from the OKLCH values through linear sRGB.

| pair | light | dark | floor |
|---|---|---|---|
| body text on canvas | 16.46 | 15.57 | 4.5:1 |
| body text on card | 17.04 | 14.38 | 4.5:1 |
| body text on strongest fill | 14.98 | 11.00 | 4.5:1 |
| secondary text on canvas | 8.06 | 10.13 | 4.5:1 |
| reading secondary on card | 7.33 | 8.15 | 4.5:1 |
| muted on canvas | 5.71 | 7.10 | 4.5:1 |
| muted on card | 5.91 | 6.56 | 4.5:1 |
| muted-2 on card | 4.78 | 5.64 | 4.5:1 |
| faint and placeholder on card | 3.89 (pre-existing) | 4.64 | 4.5:1 |
| accent as text on canvas | 6.80 | 9.77 | 4.5:1 |
| accent as text on card | 7.04 | 9.03 | 4.5:1 |
| accent as text on accent tint | 5.91 | 6.87 | 4.5:1 |
| link on canvas | 8.42 | 10.48 | 4.5:1 |
| seam label on canvas | 5.57 | 6.26 | 4.5:1 |
| accent fill against canvas | 3.88 | 7.74 | 3:1 |
| label on accent fill | 3.97 (pre-existing) | 7.92 | 4.5:1 |
| label on the solid object | 16.37 | 9.55 | 4.5:1 |
| solid object against canvas | 16.46 | 9.14 | 3:1 |
| body text on counter-surface | 13.68 | 14.39 | 4.5:1 |
| secondary on counter-surface | 9.93 | 10.00 | 4.5:1 |
| muted on counter-surface | 4.75 | 6.43 | 4.5:1 |
| accent on counter-surface | 6.68 | 9.31 | 4.5:1 |
| hash on counter-surface | 9.49 | 12.16 | 4.5:1 |
| live dot on counter-surface | 6.85 | 9.18 | 3:1 |
| live dot on canvas | 3.25 | 7.81 | 3:1 |
| wait dot on canvas | 2.12 (pre-existing) | 9.13 | 3:1 |
| error text on canvas | 4.99 | 6.67 | 4.5:1 |
| error text in the error box | 9.33 | 9.27 | 4.5:1 |
| toast text on toast | 15.90 | 11.10 | 4.5:1 |
| body text on sealed ground | 15.90 | 16.95 | 4.5:1 |
| veil label on sealed ground | 6.84 | 9.60 | 4.5:1 |

Every dark pair clears its floor. The three headline figures the brief asked
for, taken on the most common surface each colour appears on:

- body text on the canvas: **15.57:1**
- muted text on the canvas: **7.10:1**
- the accent as text on a card: **9.03:1**

Four light-theme pairs sit under their floor. All four are pre-existing Calm
values that this pass was told to leave alone, and all four are now visible as
token values rather than buried literals: `--faint` as placeholder text
(3.89), `--on-acc` on the accent send button (3.97), the wait dot (2.12), and
the selected-tab surface separation.

WCAG ratios compress badly at the dark end and say nothing useful about two
near-black surfaces, so surface separation is stated in OKLab lightness
points instead:

| separation | light | dark |
|---|---|---|
| counter-surface vs canvas | 76.2 | 6.0 |
| canvas vs raised card | 1.2 | 3.5 |
| providers band vs the card on it | 2.9 | 6.5 |
| tab track vs the selected tab | 4.4 | 6.5 |
| sealed ground vs canvas | 1.2 | 5.5 |

## Deliberate changes to light

Two, both from collapsing a duplicated role onto one token, and both below the
threshold of visibility:

- The "Sealed in the rollup" card's text moves from 96% to 92% lightness, the
  same `--on-deep` the hero's ledger panel already used. One role, one token.
- The chat thread header's rule moves from 93% to 94%, joining `--hair-0` with
  the ledger row rules.

Every other light value was verified unchanged against the original literals
by reading computed styles in the browser.

## Verified

`node node_modules/typescript/bin/tsc -p app --noEmit` clean;
`npm --workspace app run build` passing; the Impeccable design detector
returns no findings on the changed files.

Both themes were inspected at 1440 and 375: the landing top to bottom, the
chat empty state and composer, the chat rail sheet on the phone, the jobs
page, the provider page including the network panel and its stat row and
provider table, and the wallet modal with its devnet disclosure expanded.
Screenshots are alongside this file as `dark-*.png`.

## Not verified

A wallet cannot be connected in a headless browser, so these were never
rendered from real state:

- The chat thread with messages in it: user bubbles, the assistant mark, the
  per-message pipeline and its step meter, and the approve and reject actions.
- The jobs list with rows, the selected-row state, and the job detail panel
  with its timeline and escrow block.
- The faucet banner, which only mounts for a connected wallet with a low
  balance.
- The provider register form and the model filter chips.
- Toasts, including the error variant.

The `Sealed` reveal is in the same category, so its markup was injected into a
running page to photograph both states; that capture is `dark-sealed.png`.
Every unverified surface above is built entirely from tokens that were checked
elsewhere, so the risk is composition rather than colour.

The provider page's "Still trust" styling named in the brief does not exist on
that route in this working tree; the class it refers to lives only on the
landing page, where it is covered above.

## Light-theme contrast repair (controller, 2026-09-10)

Lifting the literals onto tokens exposed three light values below their floor.
They were pre-existing Calm values, invisible while buried in the stylesheet.
Measured by rasterising each token pair to sRGB in the browser and computing
the WCAG ratio, before and after:

| Token | Role | Floor | Before | After | Change |
| --- | --- | --- | --- | --- | --- |
| `--faint` | placeholder and hint text | 4.5 | 3.76 | 4.84 | L 60% to 54% |
| `--on-acc` on `--acc` | label on the accent button | 4.5 | 3.94 | 5.05 | accent L 58% to 52% |
| `--wait` | pending status dot | 3.0 | 2.12 | 3.50 | L 75% C 0.05 to L 62% C 0.11 |

The accent moved rather than the label, because the label is already near
white. A deeper sage also reads better on a warm ground. `--live` sits at
3.27 against the canvas, which clears the 3.0 floor for a non-text indicator.

The fourth item, the selected-tab separation, is left as it is: that state is
carried by weight, an inset shadow and `aria-current`, not by colour alone,
and raising the fill would visibly coarsen the toggle.

Dark was already clear throughout; its lowest pair is faint on the raised
surface at 4.64.
