# Private Inference Network — MagicBlock architecture

Date: 2026-09-04
Status: approved 2026-09-04 (amended after toolchain/SDK verification, see Amendments)

## Decision

Use a Private Ephemeral Rollup (PER) with two delegated PDAs per job — a public `Job` record and a
private `JobPrivate` record — for the low-latency private inference loop; keep the provider registry
and SOL escrow on the Solana base layer; settle via a terminal commit-and-undelegate of both job
PDAs with an idempotent `settle` handler (scheduled as a Magic Action, and directly callable as a
fallback) when the requester approves, rejects, cancels, or the job expires.

## Goals and non-goals

Goals:

- Requesters post inference jobs whose prompt and output are hidden from the public chain and from
  every wallet except the requester and the claiming provider.
- Providers discover open jobs, run inference off-chain, and submit output at ER speed.
- Settlement in SOL on Solana: payout to the provider on approval, refund to the requester on
  rejection, cancellation, or expiry.
- Provider reputation (completed / rejected counters) on base.
- Web UI for requester and provider, plus a Node provider worker.

Non-goals (v1):

- Proving that a provider ran a specific model. See "Trust model".
- Staking, slashing, or third-party arbitration of disputes.
- Streaming token-by-token output.
- Multiple providers per job, bidding, or price discovery.
- Mainnet deployment. Target is devnet.
- SPL token payment (SOL only).

## Trust model (stated plainly)

| Claim | Class | Basis |
| --- | --- | --- |
| Prompt and output bytes are not readable by non-members while the job is live on the PER | Protocol guarantee | PER `EphemeralPermission` with `is_private = true` on the TEE validator |
| Prompt and output bytes never reach the base layer in plaintext | Application policy | Every terminal path zeroes both fields on the ER before commit-and-undelegate |
| The provider actually ran the claimed model | Not provided | Nothing in this design attests provider compute. The TEE is MagicBlock's validator, not the provider's machine |
| Output integrity after settlement | Integration validation | `prompt_hash` and `output_hash` (SHA-256) commit on base; either party can prove what was exchanged |
| Provider is paid only if the requester approves | Application policy | `settle` pays only when `Job.status == Approved`; refunds otherwise |
| Requester cannot both keep the output and withhold payment without cost | Weak, reputation only | A rejection increments the provider's `rejected` counter; no economic penalty and no requester-side record in v1 |

## Assumptions and open questions

- ASSUMPTION: The TEE devnet validator (`devnet-tee-as.magicblock.app`) is live and accepts
  delegations from third-party programs. Affects: the entire PER path. Checked live via
  `https://status.magicblock.app/api/services` before every devnet run.
- ASSUMPTION: A public permission (`is_private = false`, empty members) on `Job` makes it readable
  via ordinary RPC on the TEE endpoint, including `getProgramAccounts`. Affects: provider job
  discovery. Fallback: worker listens to base `JobCreated` events and reads each job by address.
- ASSUMPTION: In one base-layer attempt, commit-and-undelegate finalizes before the post-commit
  action runs, so `settle` sees `Job` owned by this program again. Affects: whether `settle` can use
  `Account<'info, Job>` or must deserialize an `UncheckedAccount`. Verified first on devnet; the
  handler will deserialize manually from an `UncheckedAccount` to be safe either way.
- ASSUMPTION: Two PDAs delegated in the same base transaction to the same `validator` pubkey land on
  the same ER FQDN. Affects: single-transaction claim/approve flows. Verified via router
  `getDelegationStatus` on both accounts before any joint ER transaction.
- ASSUMPTION: Provider worker calls an OpenAI-compatible HTTP endpoint (Ollama locally by default).
  Affects: worker config only.
- ASSUMPTION: Rust `ephemeral-rollups-sdk` 0.16.2 with features `["anchor", "access-control"]`,
  Anchor 1.0.2, TypeScript SDK 0.15.5. Versions re-verified against crates.io and npm at scaffold
  time; the skill's snapshot is a starting point, not a recommendation.
- DECIDED: prompt max 4096 bytes, output max 5120 bytes. Solana rejects accounts larger than
  10240 bytes when created through CPI (Anchor `init`), so 4096 + 8192 is impossible in one PDA.

## Product selection

| Capability | Selection | Rationale | Rejected alternative |
| --- | --- | --- | --- |
| Private shared job state | PER (TEE validator + `EphemeralPermission`) | Only MagicBlock primitive that hides account data from non-members | Private Payments API: wrong shape, it moves tokens, not app state |
| Fast job loop (prompt, claim, submit, approve) | Public ER execution on the same TEE validator | Single runtime for all job mutations; no cross-runtime workflows | Base-only: 400ms per step and no privacy |
| Payment | SOL held in a base `Escrow` PDA | Fewest moving parts; lamports never delegated | Ephemeral SPL Token: adds deposit/withdraw lifecycle for no gain |
| Base side-effect on settlement | Magic Action to `settle_action` + directly callable `settle_direct` | Showcases commit-linked base effects; direct path guarantees liveness if the action is stripped | Action only: retry stripping could leave escrow unpaid |
| Expiry | Permissionless `expire_job` after deadline | No crank needed; provider or requester has incentive to call | Cranks: unnecessary scheduler dependency |
| Randomness, oracle, session keys | Not used | No requirement | — |

## Account and authority model

| Account | Owner / derivation | Authority | Created on | Persistence | ER role | Delegation group | Commit / close policy | Privacy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Provider` | program; PDA `["provider", wallet]` | provider wallet | base | base-settled | none (read-only clone when claiming) | none | never delegated; counters written by `settle` on base | public |
| `Job` | program; PDA `["job", requester, nonce_le_u64]` | requester (create/prompt/approve/reject/cancel), provider (claim/submit), anyone (expire) | base | base-settled | write | `job:<addr>` on TEE validator | commit-and-undelegate on every terminal path | public permission on ER |
| `JobPrivate` | program; PDA `["job-private", job]` | same as `Job`; signs permission CPIs with its own seeds | base | base-settled (scrubbed) | write | `job:<addr>` on TEE validator | zeroed, permission closed, then commit-and-undelegate with `Job` | private permission: `[requester]` → `[requester, provider]` |
| `Escrow` | program; PDA `["escrow", job]` | program only | base | base-settled | none | none | lamports released by `settle`; closed to requester after settlement | public |
| `permission(JobPrivate)` | Permission Program; PDA `[PERMISSION_SEED, job_private]` | `JobPrivate` PDA | ER | ER-only | write | same as `JobPrivate` | closed on terminal path; rent refunds to `JobPrivate` | n/a |
| `permission(Job)` | Permission Program; PDA `[PERMISSION_SEED, job]` | `Job` PDA | ER | ER-only | write | same as `Job` | closed on terminal path | n/a |

### Account layouts

```rust
#[account]
pub struct Provider {
    pub authority: Pubkey,
    pub model_label: [u8; 32],     // e.g. "llama3.1:8b", zero-padded
    pub completed: u32,
    pub rejected: u32,
    pub bump: u8,
}

#[repr(u8)]
pub enum JobStatus { Created, Open, Claimed, Submitted, Approved, Rejected, Cancelled, Expired }

#[account]
pub struct Job {
    pub requester: Pubkey,
    pub provider: Pubkey,          // Pubkey::default() until claimed
    pub nonce: u64,
    pub status: JobStatus,
    pub price_lamports: u64,
    pub deadline_unix: i64,        // claim must be submitted before this
    pub model_label: [u8; 32],
    pub prompt_hash: [u8; 32],
    pub output_hash: [u8; 32],
    pub created_at: i64,
    pub claimed_at: i64,
    pub submitted_at: i64,
    pub bump: u8,
}

#[account]
pub struct JobPrivate {
    pub job: Pubkey,
    pub prompt_len: u16,
    pub output_len: u16,
    pub prompt: [u8; PROMPT_MAX],  // PROMPT_MAX = 4096
    pub output: [u8; OUTPUT_MAX],  // OUTPUT_MAX = 5120
    pub bump: u8,
}

#[account]
pub struct Escrow {
    pub job: Pubkey,
    pub amount: u64,
    pub paid: bool,
    pub bump: u8,
}
```

`JobPrivate` is pre-funded at creation with
`ephemeral_accounts::rent(EphemeralPermission::size_of(MAX_PERMISSION_MEMBERS))` where
`MAX_PERMISSION_MEMBERS = 2`. `Job` is pre-funded for `size_of(0)`.

### Authorization rules (enforced identically on base and ER)

- `write_prompt`, `finalize_prompt`, `approve_job`, `reject_job`, `cancel_job`: `signer == job.requester`.
- `claim_job`: signer has a `Provider` PDA; `job.status == Open`; `job.provider == default`.
- `write_output`, `finalize_output`: `signer == job.provider`; `job.status == Claimed`; `finalize_output` also requires `now < deadline`.
- `expire_job`: anyone; `job.status ∈ {Open, Claimed}`; `now >= deadline`.
- `cancel_job`: `job.status ∈ {Created, Open}` only. Once claimed, the requester must wait for
  submission or expiry.
- `cancel_job_base` (base layer): requester signer; `job.status == Created` and the job is still owned
  by the program (never delegated). Sets `Cancelled` so `settle_direct` can refund.
- Auto-approve: `approve_job` may be called by anyone once `job.status == Submitted` and
  `now >= deadline_unix + AUTO_APPROVE_SECS` (3600). Prevents an absent requester from locking the
  escrow forever. Before that moment, `approve_job` requires the requester.
- Permission CPIs are only reachable through these instructions; never through a bare instruction.

## Transaction routing

| Flow | Actor / signers | Writable accounts | Destination | Preconditions | Settlement / confirmation | Failure path |
| --- | --- | --- | --- | --- | --- | --- |
| `register_provider(model_label)` | provider | `Provider` | base | none | confirmed on base | retry |
| `create_job(nonce, price, deadline, model_label)` | requester | `Job`, `JobPrivate`, `Escrow` | base | none | confirmed on base; emits `JobCreated{job, price, model_label, deadline}` | retry; nonce reuse fails on `init` |
| `delegate_job(validator)` | requester | `Job`, `JobPrivate` (+ delegation accounts) | base | `job.status == Created`; both PDAs owned by program | router `getDelegationStatus` returns same `fqdn` for both; base owner == Delegation Program; ER owner == program | poll with 60s timeout; if only one delegated, delegate the other individually |
| `init_permissions` | requester | `permission(Job)`, `permission(JobPrivate)`, `Job`, `JobPrivate` | TEE ER | both delegated | permission PDAs exist on ER | idempotent; retry |
| `write_prompt(offset, chunk)` (repeat, chunk <= 900 bytes) | requester | `JobPrivate` | TEE ER | `status == Created` | bytes stored | retry chunk |
| `finalize_prompt(len)` | requester | `Job`, `JobPrivate` | TEE ER | `status == Created`; permissions exist | `status == Open`, `prompt_hash` = SHA-256 computed on-chain | retry |
| `claim_job` | provider | `Job`, `JobPrivate`, `permission(JobPrivate)` | TEE ER | `status == Open`; `Provider` PDA exists (read-only clone) | `status == Claimed`; provider now a member | if two providers race, second fails on status check |
| `write_output(offset, chunk)` (repeat) | provider | `JobPrivate` | TEE ER | `status == Claimed` | bytes stored | retry chunk |
| `finalize_output(len)` | provider | `Job`, `JobPrivate` | TEE ER | `status == Claimed`; `now < deadline` | `status == Submitted`, `output_hash` computed on-chain | retry; after deadline → expire path |
| `approve_job` | requester | `Job`, `JobPrivate`, both permissions, magic accounts | TEE ER | `status == Submitted` | ER: `status == Approved`, fields zeroed, permissions closed; base: both PDAs owned by program again, `Escrow.paid == true` | see "Settlement" |
| `reject_job` | requester | same as approve | TEE ER | `status == Submitted` | `status == Rejected`; refund | same |
| `cancel_job` | requester | same as approve | TEE ER | `status ∈ {Created, Open}` | `status == Cancelled`; refund | same |
| `expire_job` | anyone | same as approve | TEE ER | `status ∈ {Open, Claimed}`; `now >= deadline` | `status == Expired`; refund | same |
| `settle_action` | delegation program via escrow signer | `Escrow`, `Provider`, recipient wallet | base (post-commit action) | `Job` undelegated with terminal status; `!escrow.paid` | `escrow.paid == true`; lamports moved | action stripped → `settle_direct` |
| `settle_direct` | anyone | same | base | same | same | retry |
| `close_job` | requester | `Job`, `JobPrivate`, `Escrow` | base | `escrow.paid == true` | rent returned to requester | retry |

Worker read paths (no signature):

- Discover: `getProgramAccounts` on TEE ER filtered by `Job` discriminator and `status == Open`,
  plus subscribe to base `JobCreated` logs as fallback.
- Read prompt: `getAccountInfo(job_private)` on TEE ER after authenticating with the signed
  challenge flow as the provider wallet. Must fail before `claim_job`, succeed after.

## Delegation and settlement lifecycle

1. Base: `register_provider` once per provider. `create_job` funds escrow and permission rent.
2. Base: `delegate_job` with `DelegateConfig { validator: Some(tee_identity) }` for both PDAs.
   Resolve `tee_identity` with JSON-RPC `getIdentity` on the TEE endpoint at client start.
3. Client polls router `getDelegationStatus` for both PDAs until both report `delegated=true` with
   the same `fqdn`.
4. TEE ER: `init_permissions`, `write_prompt` chunks, `finalize_prompt`. Provider worker: `claim_job`,
   reads prompt, runs inference, `write_output` chunks, `finalize_output`. Requester reads output.
5. TEE ER: terminal instruction (`approve_job`, `reject_job`, `cancel_job`, `expire_job`):
   1. set `status`;
   2. zero `JobPrivate.prompt`, `output`, and lengths;
   3. `CloseEphemeralPermissionCpi` on both permissions (rent refunds to the PDAs);
   4. `MagicIntentBundleBuilder::new(signer, magic_context, magic_program)`
      `.commit_and_undelegate(&[job, job_private])`
      `.add_post_commit_actions([settle_action])`
      `.build_and_invoke()`.
   Escrow authority for the action is the terminal signer's wallet (user-paid). The client funds
   that wallet's ephemeral balance PDA (`["balance", wallet, 255]`) once, at first use, via the SDK
   top-up helper. `expire_job` may be called by a wallet with no funded balance PDA; in that case
   the instruction skips the action and relies on `settle_direct`. Implementation: pass
   `schedule_action: bool` and let the client decide.
6. Base: `settle` runs. It reads `Job` from an `UncheckedAccount` (owner must be this program,
   status must be terminal), reads `Escrow`, and:
   - `Approved` → transfer `amount` to `job.provider`, `provider.completed += 1`;
   - `Rejected` → transfer to `job.requester`, `provider.rejected += 1`;
   - `Cancelled` / `Expired` → transfer to `job.requester`; if a provider had claimed, no counter
     change.
   Sets `escrow.paid = true`. A second call returns `AlreadySettled` without side effects.
7. Worker reconciliation loop (every 30s): for each job it has claimed, read base `Job`; if owner
   is this program, status is terminal, and `Escrow.paid == false` for more than 60s, send
   `settle_direct`. Requester UI does the same for its own jobs.
8. Base: `close_job` reclaims rent.

Commit budget: exactly one commit per job (the terminal one), well under the 10-commit plain limit.
No fee vault or delegated payer.

## Provider worker

Node + TypeScript process, one per provider wallet.

- Config: keypair path, base RPC, router URL, TEE ER URL, inference endpoint URL and model name,
  poll interval.
- Startup: `getIdentity` on TEE ER; challenge-sign-login as the provider wallet; ensure `Provider`
  PDA exists.
- Loop: discover Open jobs whose `model_label` matches; `claim_job`; read `JobPrivate` (must now
  succeed as member); POST prompt to the inference endpoint; `write_output` chunks; `finalize_output`.
- Guards: skip jobs whose `deadline_unix - now < 30s`; truncate output to `OUTPUT_MAX` and mark
  truncation with a trailing marker; never log prompt or output bodies.
- Reconciliation loop as in step 7.

## Web UI

Vite + React + TypeScript, `@solana/wallet-adapter`, `@coral-xyz/anchor`,
`@magicblock-labs/ephemeral-rollups-sdk`. Three connections: base, router, TEE ER (authenticated).

Screens:

- Requester: new job form (model, price, deadline, prompt); job list with status pill
  (`Created → Open → Claimed → Submitted → Approved/Rejected/Cancelled/Expired`, plus
  `settling` / `settled` derived from base `Escrow.paid`); job detail with output view and
  approve/reject buttons; close-job button when settled.
- Provider: register form; provider card (completed, rejected); list of jobs claimed by this
  wallet with status and payout state.
- Global: TEE health badge from the status API; router `fqdn` shown per job.

`Created → Open` is two signed transactions (delegate on base, then permissions + prompt on the ER)
shown as one "Publish" action with a progress stepper.

## Security and operations

- Trust boundary: PER hides `JobPrivate` from non-members. Application authorization is separate
  and enforced in every instruction. Permission membership never substitutes for a signer check.
- `settle_action` requires the injected `escrow` signer pinned to
  `ephemeral_balance_pda_from_payer(escrow_auth, 255)`; `settle_direct` is a plain permissionless
  instruction. Both call one shared `fn settle(...)`.
- Plaintext never commits: terminal instructions zero private fields before the intent bundle.
  Unit test asserts the committed `JobPrivate` bytes are all zero except `job` and `bump`.
- Sponsorship: requester pays rent, escrow, and the ER transaction fees for its own instructions.
  Provider pays its own. No relayer.
- Failure and recovery: delegation stall → client re-checks router with timeout, can re-send
  `delegate_job` for the missing account. Action stripped → `settle_direct`. TEE down → UI shows
  badge, worker pauses; jobs already on the ER wait; nothing is lost because escrow is on base.
  Job stuck on ER past deadline → anyone calls `expire_job`.
- Observability: log ER signature, `GetCommitmentSignature` result, base confirmation, and
  `Escrow.paid` per terminal flow. Status API check before test runs.
- Manual recovery owner: the requester wallet (cancel/expire/close), or any wallet for
  `expire_job` and `settle_direct`.

## Validation plan

| Claim | Environment | Setup / command | Pass signal | Evidence retained | Not covered |
| --- | --- | --- | --- | --- | --- |
| Authorization and status transitions | Anchor unit tests (LiteSVM or anchor test on local validator) | `anchor test` | all negative cases rejected with expected error codes | test output | delegation, privacy |
| Private fields zeroed before commit | Anchor unit test | `anchor test` | serialized `JobPrivate` after terminal ix has zero prompt/output | test output | ER commit itself |
| `settle` idempotent and pays correct party | Anchor unit test | `anchor test` | second call errors `AlreadySettled`; balances match | test output | action path |
| Delegation of both PDAs to one validator, commit-and-undelegate | mb-stack local | `npx --yes --package=@magicblock-labs/ephemeral-validator@0.13.7 mb-stack` (known-good snapshot; re-verify on npm) + `anchor deploy` + TS test | base owner flips to Delegation Program and back; ER owner == program | signatures from both runtimes | TEE privacy, router |
| Router discovery, TEE delegation, permission gating | devnet TEE | TS integration test against `devnet-tee-as.magicblock.app` | non-member read of `JobPrivate` fails; member read succeeds; both PDAs report same `fqdn` | signatures, RPC error bodies | mainnet |
| Magic Action delivers `settle`; stripped action recovered by `settle_direct` | devnet TEE | approve flow with funded balance PDA; second run with unfunded PDA | `Escrow.paid == true` in both runs, second via direct call | base signatures | production load |
| Discovery via ER `getProgramAccounts` | devnet TEE | worker dry-run | Open job listed within one poll interval | worker log | — |
| End-to-end demo | devnet TEE + local Ollama | UI + worker | requester sees output, approves, provider balance increases | screen recording | — |

Every devnet run starts with a status API check for `devnet` / `tee` / `er` live status.

## Repository layout

```
programs/inference_market/         Anchor program (Rust)
  src/lib.rs                       #[ephemeral] #[program], thin handlers
  src/state.rs                     account structs, JobStatus, constants
  src/instructions/*.rs            one file per instruction
  src/settle.rs                    shared settle fn + action/direct contexts
  src/errors.rs
tests/                             anchor unit tests + devnet integration tests
worker/                            Node provider worker
app/                               Vite React UI
docs/superpowers/specs/            this document
tasks/todo.md                      implementation plan (next step)
```

## Risks

- TEE devnet unavailable during the build window — mitigation: mb-stack covers everything except
  privacy; privacy tests are the last gate. Owner: user.
- Action-in-same-transaction-as-undelegate assumption wrong — mitigation: `settle` reads
  `UncheckedAccount` and `settle_direct` is always available. Owner: implementation.
- ER `getProgramAccounts` not supported on TEE endpoint — mitigation: base `JobCreated` event
  listener already in the worker. Owner: implementation.
- Large `JobPrivate` (about 12 KB) raises rent and delegation cost — mitigation: sizes are
  constants; user decides in OPEN question. Owner: user.
- Requester withholds approval after reading output — accepted v1 risk, reputation only; documented
  in trust model. Owner: product.

## Amendments (2026-09-04, after verification)

- Toolchain: this machine has Node 26 and git only. Rust, Solana, Anchor, WSL, and Ollama are absent.
  The plan installs WSL2 Ubuntu and the toolchain inside it.
- Versions pinned to the skill-verified snapshot: Rust SDK 0.16.2 (`anchor`, `access-control`),
  anchor-lang 1.0.2, `@coral-xyz/anchor` 0.32.1, TS SDK 0.15.5. Newer releases exist (Rust SDK
  0.17.0, anchor-lang 1.1.2, TS SDK 0.17.0, published 2026-08-26); upgrade is a separate task.
- Account size: output max 5120 (not 8192) because CPI-created accounts are capped at 10240 bytes.
- Transaction size: prompt and output are written in chunks (`write_*` + `finalize_*`), and the
  program computes the SHA-256 hash on-chain at finalize time.
- `Job.settled` removed; `Escrow.paid` is the only settlement marker.
- Validation ladder: TEE devnet (`devnet-tee-as.magicblock.app`, ER live at planning time) is the
  primary integration gate. mb-stack is optional; it cannot exercise the permission program.
- TS auth flow verified in SDK 0.15.5: `getAuthToken(rpcUrl, pubkey, signMessage)` returns
  `{ token, expiresAt }`; the token is appended as `?token=` to the TEE HTTP and WS URLs.
- Task 6 review (2026-09-04): added `cancel_job_base` (base-layer refund path for never-delegated
  jobs) and auto-approve of Submitted jobs after `deadline + AUTO_APPROVE_SECS` (3600 s). Both close
  fund-lock gaps in the transition table. `settle_action` requires the terminal signer to hold a funded
  ephemeral balance PDA (index 255); third-party `expire_job` callers should pass
  `schedule_action = false` and rely on `settle_direct`.
- Product/UI (user, 2026-09-04): the requester surface is chat-first, like ChatGPT/Claude. Each user message
  becomes one job: prompt = short system preamble + the most recent turns of that conversation trimmed
  from the oldest to fit 4096 bytes; the job output is the assistant reply. Per message: approve (pay)
  or reject (refund); optional per-conversation "auto-approve on read". Conversations are client-side
  (localStorage). No on-chain change. Visual direction: the "Calm" design canvas
  (https://claude.ai/code/artifact/a48fd524-3dd6-4920-820c-e8b577dcbe7f): warm off-white, one sage-teal
  accent, Bricolage Grotesque display, Instrument Sans body, JetBrains Mono data. Routes: / landing,
  /chat (default), /jobs (ledger + detail), /provider.
- Product name: Shh (user, 2026-09-04); slogan: The chain sees the money, never the words.
