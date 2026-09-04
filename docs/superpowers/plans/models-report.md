# Model catalog, per-model pricing, and the hero port

Three commits on the working branch:

| SHA | Subject |
| --- | --- |
| `21095e5` | client: shared model catalog with per-model pricing |
| `7baee0c` | worker: serve every catalog model of a provider, behind a price floor |
| `2432924` | app: model picker with prices, and the two-views hero |

## Model ids and where they came from

Anthropic ids come from the `claude-api` skill's current-models table, read
before any id was written.

| Provider | Tier | Id | Price (SOL) | Source |
| --- | --- | --- | --- | --- |
| anthropic | lower | `claude-haiku-4-5` | 0.002 | `claude-api` skill |
| anthropic | lower | `claude-sonnet-5` | 0.004 | `claude-api` skill |
| anthropic | default | `claude-opus-5` | 0.010 | `claude-api` skill |
| anthropic | higher | `claude-fable-5-1` | 0.020 | `claude-api` skill |
| openai | lower | `gpt-5.6-luna` | 0.002 | developers.openai.com/api/docs/models |
| openai | default | `gpt-5.6-terra` | 0.006 | developers.openai.com/api/docs/models |
| openai | higher | `gpt-5.6-sol` | 0.012 | developers.openai.com/api/docs/models |
| ollama | lower | `llama3.2:1b` | 0.0005 | task spec |
| ollama | default | `llama3.1:8b` | 0.001 | task spec |
| ollama | higher | `llama3.3:70b` | 0.003 | task spec |

The OpenAI ids were verified live rather than falling back to the
`gpt-4o-mini` / `gpt-4o` / `gpt-5` placeholder the task allowed. The docs page
at `platform.openai.com/docs/models` now redirects to
`developers.openai.com/api/docs/models`, which lists the GPT-5.6 family
(`gpt-5.6-luna` cost-optimized, `gpt-5.6-terra` balanced, `gpt-5.6-sol`
flagship) plus `gpt-6-astra` as the most capable model. A second search
corroborated the three GPT-5.6 ids and their public pricing.

`gpt-6-astra` is deliberately not in the catalog: it is rolling out through
OpenAI's Trusted Access Program first, so a provider worker pointed at a normal
API key could advertise it and then fail every job. `gpt-5.6-sol` takes the
higher tier and carries a note saying so. If broad access lands, promoting
astra is a one-row change.

Every id is at most 16 bytes, well inside the 32-byte `model_label`; a unit
test asserts it.

## What changed, per file

### client

- **`client/src/models.ts`** (new). `Provider`, `Tier`, `ModelSpec`, `MODELS`,
  `DEFAULT_MODEL_ID` (`claude-opus-5`), `modelById`, `modelsFor`,
  `priceLamports`. Two extras the app and the tests both wanted: `PROVIDERS`
  and `PROVIDER_NAMES` for the picker's group headings, and `idBytes` and
  `fitsLabel` for the label-width check.
- **`client/src/index.ts`**. Re-exports `./models`.
- **`client/src/__tests__/models.test.ts`** (new). Label width, unique ids, one
  default per provider, all three tiers present, prices strictly increasing
  across tiers within a provider, `modelsFor` ordering, `DEFAULT_MODEL_ID`
  identity, and integer lamport conversion.
- **`client/package.json`**. The `test` script invoked `tsx` off PATH, which no
  bin link on this machine resolves. It now uses
  `node ../node_modules/tsx/dist/cli.mjs`, matching the worker.

`label32` and every existing flow are untouched. The job's `model_label` is
still set from whatever string the caller passes; it is now a catalog id.

### worker

- **`worker/src/config.ts`**. `ANTHROPIC_MODEL`, `OPENAI_MODEL`,
  `OLLAMA_MODEL` and `MODEL_LABEL` are gone. `INFERENCE_PROVIDER` is unchanged.
  New: `MODELS` (comma-separated catalog ids, default all of the provider's
  rows), `PRICE_FLOOR_MULTIPLIER` (default 1.0, floor is the catalog price
  times the multiplier, rounded up to whole lamports), and `MODEL_MAP` (JSON
  from catalog id to backend model id). Every one of them fails at boot rather
  than at claim time: an unknown id, an id from a different provider, a
  malformed `MODEL_MAP`, or a negative multiplier all throw. `cfg.inference` is
  now the backend connection without a model; `cfg.served` is a map keyed by
  catalog id.
- **`worker/src/discover.ts`**. `findClaimable(er, served, minTimeLeftS)` now
  returns `{ jobs, skippedUnderpriced }`, where each job carries the catalog id
  its label decoded to. `decodeLabel` is exported and cuts the fixed 32-byte
  array at the first NUL. A job is claimable when its label names a served
  model, its price is at or above that model's floor, and its deadline is more
  than `minTimeLeftS` away. Underpriced jobs are counted and logged as a bare
  number.
- **`worker/src/index.ts`**. Registers under `cfg.registerLabel`, logs the
  served-model count at boot, and runs inference with the backend model
  resolved from the job's own label.
- **`worker/src/__tests__/discover.test.ts`** (new). Fake job rows covering a
  job exactly at the floor, one over it, one a lamport short, another
  provider's model, a label absent from the catalog, a deadline too close, and
  a 1.5x floor multiplier rejecting a catalog-rate job.
- **`worker/.env.example`** and **`README.md`**. Rewritten for the new
  variables.

One judgment call: the `Provider` account still carries a single 32-byte label,
but a worker now answers for several models. It registers under its
default-tier served model, falling back to the first served model.

### app

- **`app/src/components/ModelPicker.tsx`** (new). Groups the catalog by
  provider (Claude, GPT, Ollama), each row showing the name, a tier badge, the
  price per message, and the spec's note where there is one. Rows are 44px or
  taller; the list scrolls inside itself and is capped at one viewport width
  less 40px.
- **`app/src/hooks/useDismiss.ts`** (new). The Escape and outside-click
  behaviour `PillMenu` already had, extracted so the picker shares it.
- **`app/src/components/PillMenu.tsx`**. Moved onto that hook. No behaviour
  change.
- **`app/src/pages/Chat.tsx`**. The model chip is the picker. Choosing a model
  sets the job price to that model's rate. The price pill's options are the
  standard ladder with the model's own rate folded in and marked as the model's,
  and both the pill and the rail's per-message line append a custom marker when
  the price no longer matches the model's rate. The rail names the model rather
  than its id, with the id on hover.
- **`app/src/lib/chat.ts`**. A fresh conversation starts at `DEFAULT_MODEL_ID`
  and its price. The store key moves to `im.chat.v2`.
- **`app/src/lib/chat.test.ts`**. The store-key expectation follows.
- **`app/src/pages/Landing.tsx`** and **`app/src/index.css`**. The hero
  schematic is replaced by the artboard's two-views block, and the provider
  pitch mentions the per-model price floor. The `.schematic`, `.node` and
  `.settled-strip` rules are gone; the `.views` family replaces them.

The Jobs page has no composer, so nothing there needed the picker.

## Deviations from the artboard

The artboard's chain panel is 296px inside a 616px hero column. This app's hero
is 1.12fr / 0.88fr, so the right column is about 535px. Holding 296px left the
paper panel at 238px, which stretched the sample reply to eight lines and the
whole block to 490px tall. Measured in the browser, the widest mono row needs
221px of the 296, so the column is capped at 276px; the panels then come out
roughly even and the block is about 420px tall. Every token, radius, font size
and the 560ms staggered rise are the artboard's.

The footer's latency figure is the artboard's literal `3.8 s`. That is
end-to-end answer time, not the rollup step latency the proof strip measures,
so it is not wired to `useLastStepMs` -- that would have put `41 ms` under a
label meaning something else.

## Verification

TypeScript, all three workspaces, no output and then `ALL_TSC_CLEAN`:

```
node node_modules/typescript/bin/tsc -p client --noEmit
node node_modules/typescript/bin/tsc -p worker --noEmit
node node_modules/typescript/bin/tsc -p app/tsconfig.app.json --noEmit
ALL_TSC_CLEAN
```

Client tests:

```
tests 12
pass 12
fail 0
```

Worker tests:

```
{"t":"2026-09-04T18:58:59.728Z","msg":"skipped underpriced","jobs":1}
{"t":"2026-09-04T18:58:59.731Z","msg":"skipped underpriced","jobs":1}
ok decodeLabel strips the zero padding
ok claims a served model priced at its floor, skips underpriced and unknown
ok an unserved model is never counted as underpriced
ok a job too close to its deadline is not claimed
ok a floor multiplier above 1 rejects a job priced at the catalog rate
ok truncateOutput caps at OUTPUT_MAX with marker
ok truncateOutput never splits a multi-byte character
ok runInference (openai) posts chat/completions and returns bytes
ok runInference (ollama) posts to the OpenAI-compatible endpoint with no auth header
ok runInference (anthropic) posts Messages API and returns bytes
ok runInference throws with status code, not body, on non-2xx
tests 11
pass 11
fail 0
```

App chat tests: 12 passed, 0 failed. App build finished in 21.03s.

Browser checks against the production build, at 1440x1000 and 375x812:

- Landing hero at 1440. Panels 276 / 1 / 258, block 420px tall, no row
  ellipsised, document scroll width 1425 against a 1440 window.
- Landing hero at 375. Panels stacked, seam a horizontal rule with the label
  upright, document scroll width 360 against a 375 window.
- Model picker at 375. 292px wide, every row 44px or taller, no horizontal
  scroll.
- Selecting Llama 3.3 70B moved the composer pill and the rail to 0.003 SOL;
  then choosing 0.01 SOL from the price pill showed a custom marker in both
  places. The price list read 0.0005, 0.001, 0.002, 0.003 (marked as the
  model's), 0.005, 0.01, 0.02, 0.05.

## Unverified

- Prices are illustrative devnet figures, as specified. They are not calibrated
  against real per-token cost; they only preserve the ordering.
- No worker was run against a live backend, so `MODEL_MAP` and
  `PRICE_FLOOR_MULTIPLIER` are covered by unit tests and boot-time validation
  only.
- The GPT-5.6 ids were read from OpenAI's docs and a corroborating search, not
  from a live API call with a key.
