# Private Inference Network Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every task that touches MagicBlock code must load the `magicblock` skill first; Anchor/Solana scaffolding tasks also load `solana-dev` if available.

**Goal:** A devnet-deployed marketplace where requesters post private LLM inference jobs on a MagicBlock Private Ephemeral Rollup, providers run them off-chain and submit output privately, and SOL escrow settles on Solana when the requester approves.

**Architecture:** One Anchor program (`inference_market`) with a public `Job` PDA and a zero-copy private `JobPrivate` PDA per job, both delegated to the TEE validator; `Provider` and `Escrow` PDAs stay on base. All job mutations are ER transactions; every terminal instruction scrubs private bytes, closes permissions, and commit-and-undelegates with a `settle_action` Magic Action; `settle_direct` is the permissionless fallback. A TypeScript client library is shared by tests, a Node provider worker, and a Vite React UI.

**Tech Stack:** Rust 1.89.0, Anchor 1.0.2 (`anchor-lang`, CLI via avm), `ephemeral-rollups-sdk` 0.16.2 (`anchor`, `access-control`), Agave Solana CLI (stable), Node 24 in WSL, `@coral-xyz/anchor` 0.32.1, `@magicblock-labs/ephemeral-rollups-sdk` 0.15.5, `@solana/web3.js` 1.x, `@noble/hashes`, `tsx`, Vite + React 18, `@solana/wallet-adapter-react`.

**Spec:** `docs/superpowers/specs/2026-09-04-private-inference-network-design.md`

## Global Constraints

- Rust SDK `ephemeral-rollups-sdk = { version = "0.16.2", features = ["anchor", "access-control"] }`; `anchor-lang = { version = "1.0.2", features = ["init-if-needed"] }`. Do not upgrade to 0.17.0 / 1.1.2 in this plan.
- TS: `@magicblock-labs/ephemeral-rollups-sdk@0.15.5`, `@coral-xyz/anchor@0.32.1`.
- Constants (copy verbatim): `PROMPT_MAX = 4096`, `OUTPUT_MAX = 5120`, `CHUNK_MAX = 900`, `MODEL_LABEL_LEN = 32`, `MAX_PERMISSION_MEMBERS = 2`, `MIN_DEADLINE_SECS = 60`, `ACTION_ESCROW_INDEX = 255`.
- Seeds (bytes): `"provider"`, `"job"`, `"job-private"`, `"escrow"`. Job nonce is `u64` little-endian in the seed.
- Endpoints: base `https://rpc.magicblock.app/devnet`; router `https://devnet-router.magicblock.app/`; TEE ER `https://devnet-tee-as.magicblock.app` (confirm via router `getDelegationStatus` after delegating; never hardcode a different region).
- Program IDs: Delegation `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`, Permission `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`, Magic `Magic11111111111111111111111111111111111111`. In Rust use the SDK constants, never string literals.
- Never log or persist prompt or output bodies anywhere outside the ER (worker, UI, tests).
- Every devnet script starts by checking `https://status.magicblock.app/api/services` → `.environments.devnet.regions.tee.servers["devnet-tee-as.magicblock.app"].live_status.er === true` and aborts otherwise.
- Keep preflight enabled on base. On the ER use `skipPreflight: true` only where the step documents a simulation incompatibility.
- Builds run inside WSL2 Ubuntu with `CARGO_TARGET_DIR=$HOME/target/inference-market` (Windows filesystem under `/mnt/f` is too slow for `target/`).
- Commit after every task. Commit messages: `feat:`, `test:`, `chore:`, `docs:`.

---

## File Structure

```
.gitignore
Anchor.toml                         workspace + local-validator clone of delegation program
Cargo.toml                          workspace
package.json                        root: anchor tests + shared devDeps
tsconfig.json
programs/inference_market/
  Cargo.toml
  Xargo.toml
  src/lib.rs                        #[ephemeral] #[program]; thin handlers only
  src/state.rs                      constants, JobStatus, Provider, Job, JobPrivate (zero-copy), Escrow
  src/errors.rs                     MarketError
  src/logic.rs                      pure functions + cargo unit tests (transitions, chunk writes, scrub, recipient)
  src/instructions/mod.rs
  src/instructions/register_provider.rs
  src/instructions/create_job.rs
  src/instructions/delegate_job.rs  two instructions: delegate_job, delegate_job_private
  src/instructions/permissions.rs   init_permissions (ER)
  src/instructions/prompt.rs        write_prompt, finalize_prompt (ER)
  src/instructions/claim.rs         claim_job (ER)
  src/instructions/output.rs        write_output, finalize_output (ER)
  src/instructions/finish.rs        approve/reject/cancel/expire via one shared fn (ER)
  src/instructions/settle.rs        settle_action (#[action]) + settle_direct + shared settle fn (base)
  src/instructions/close_job.rs     close_job (base)
client/                             shared TS library (no framework deps)
  package.json  tsconfig.json
  src/index.ts  constants.ts  pda.ts  connections.ts  program.ts  hash.ts  chunks.ts  flows.ts  status.ts
tests/inference_market.ts           local-validator tests (base instructions + delegation)
tests/devnet/e2e.ts                 devnet TEE end-to-end (tsx script)
worker/                             provider worker
  package.json  tsconfig.json  .env.example
  src/index.ts  config.ts  inference.ts  discover.ts  reconcile.ts  log.ts
app/                                Vite React UI
  package.json  vite.config.ts  index.html
  src/main.tsx  App.tsx  wallet.tsx  hooks/useMarket.ts
  src/pages/Requester.tsx  Provider.tsx
  src/components/JobCard.tsx  NewJobForm.tsx  StatusPill.tsx  TeeBadge.tsx
README.md
tasks/todo.md                       progress tracker (mirror of task checkboxes)
```

---

### Task 0: Toolchain (WSL2 + Rust + Solana + Anchor + Node) and repo init

**Files:**
- Create: `.gitignore`, `tasks/todo.md`

**Interfaces:**
- Produces: a WSL shell where `anchor --version` prints `anchor-cli 1.0.2`, `solana --version` prints an Agave 2.x/3.x stable, `cargo --version` prints 1.89.0, `node --version` prints v24.x; a funded devnet keypair at `~/.config/solana/id.json`.

- [ ] **Step 1: Install WSL2 Ubuntu (Windows, admin PowerShell)**

```powershell
wsl --install -d Ubuntu-24.04
```
Reboot when prompted, open "Ubuntu 24.04", create a Linux user. Everything below runs in that Ubuntu shell.

- [ ] **Step 2: System packages**

```bash
sudo apt update && sudo apt install -y build-essential pkg-config libssl-dev libudev-dev llvm libclang-dev protobuf-compiler curl git
```

- [ ] **Step 3: Rust 1.89.0**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.89.0
source "$HOME/.cargo/env"
cargo --version
```
Expected: `cargo 1.89.0 (...)`.

- [ ] **Step 4: Solana (Agave) CLI**

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
solana --version
```
Expected: `solana-cli 2.x` or `3.x (Agave)`.

- [ ] **Step 5: Anchor 1.0.2 via avm**

```bash
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 1.0.2
avm use 1.0.2
anchor --version
```
Expected: `anchor-cli 1.0.2`.

- [ ] **Step 6: Node 24 via nvm**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 24 && nvm use 24
corepack enable
node --version
```
Expected: `v24.x`.

- [ ] **Step 7: Devnet keypair and funds**

```bash
solana-keygen new --no-bip39-passphrase -o ~/.config/solana/id.json
solana config set --url https://rpc.magicblock.app/devnet
solana airdrop 2 || echo "airdrop rate-limited: use https://faucet.solana.com with the address above"
solana address && solana balance
```
Expected: balance ≥ 2 SOL (repeat airdrop or use the web faucet; devnet tests need about 1 SOL per full run).

- [ ] **Step 8: Cargo target dir on Linux filesystem**

```bash
echo 'export CARGO_TARGET_DIR=$HOME/target/inference-market' >> ~/.bashrc
source ~/.bashrc
```

- [ ] **Step 9: Repo init (from WSL, in the project folder)**

```bash
cd "/mnt/f/Tools/magicblock biltz v8"
git init -b main
cat > .gitignore <<'EOF'
node_modules/
target/
.anchor/
dist/
.env
*.log
test-ledger/
app/dist/
EOF
mkdir -p tasks
cat > tasks/todo.md <<'EOF'
# Private Inference Network — task tracker

Plan: docs/superpowers/plans/2026-09-04-private-inference-network.md

- [x] Task 0 toolchain + repo init
- [ ] Task 1 Anchor workspace + state
- [ ] Task 2 pure logic + cargo tests
- [ ] Task 3 register_provider + create_job
- [ ] Task 4 delegate instructions
- [ ] Task 5 ER instructions (permissions, prompt, claim, output)
- [ ] Task 6 terminal instructions + settle + close_job
- [ ] Task 7 devnet deploy
- [ ] Task 8 TS client library
- [ ] Task 9 devnet e2e test
- [ ] Task 10 provider worker
- [ ] Task 11 web UI
- [ ] Task 12 README + demo script

## Review notes
EOF
git add -A && git commit -m "chore: repo init, spec, plan, task tracker"
```

- [ ] **Step 10: Optional local inference backend**

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2:1b
curl -s http://localhost:11434/v1/chat/completions -H 'content-type: application/json' \
  -d '{"model":"llama3.2:1b","messages":[{"role":"user","content":"say hi"}]}' | head -c 300
```
Expected: JSON with `choices[0].message.content`. If Ollama is not wanted, any OpenAI-compatible endpoint works (set `INFERENCE_URL`, `INFERENCE_API_KEY`, `INFERENCE_MODEL` in Task 10).

---

### Task 1: Anchor workspace and account state

**Files:**
- Create: `Anchor.toml`, `Cargo.toml`, `package.json`, `tsconfig.json`, `programs/inference_market/Cargo.toml`, `programs/inference_market/Xargo.toml`, `programs/inference_market/src/lib.rs`, `programs/inference_market/src/state.rs`, `programs/inference_market/src/errors.rs`, `programs/inference_market/src/instructions/mod.rs`

**Interfaces:**
- Produces: `state.rs` constants and account structs used by every later task (names and field types below are final). `errors::MarketError` variants used by every later task.

- [ ] **Step 1: Scaffold with Anchor**

```bash
cd "/mnt/f/Tools/magicblock biltz v8"
anchor init --no-git --no-install inference_market_tmp
mv inference_market_tmp/Anchor.toml inference_market_tmp/Cargo.toml inference_market_tmp/package.json inference_market_tmp/tsconfig.json .
mkdir -p programs tests
mv inference_market_tmp/programs/inference_market_tmp programs/inference_market
rm -rf inference_market_tmp
```

- [ ] **Step 2: Write `programs/inference_market/Cargo.toml`**

```toml
[package]
name = "inference_market"
version = "0.1.0"
description = "Private inference marketplace on MagicBlock PER"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "inference_market"

[features]
default = []
cpi = ["no-entrypoint"]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
idl-build = ["anchor-lang/idl-build"]

[dependencies]
anchor-lang = { version = "1.0.2", features = ["init-if-needed"] }
ephemeral-rollups-sdk = { version = "0.16.2", features = ["anchor", "access-control"] }
bytemuck = { version = "1", features = ["derive", "min_const_generics"] }
```

- [ ] **Step 3: Write `Anchor.toml`**

```toml
[toolchain]
anchor_version = "1.0.2"

[features]
resolution = true
skip-lint = false

[programs.localnet]
inference_market = "REPLACED_IN_STEP_7"

[programs.devnet]
inference_market = "REPLACED_IN_STEP_7"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "localnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "npx tsx --test tests/inference_market.ts"

[test]
startup_wait = 20000

[test.validator]
url = "https://api.devnet.solana.com"

[[test.validator.clone]]
address = "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
```

- [ ] **Step 4: Write `package.json` (root) and `tsconfig.json`**

```json
{
  "name": "inference-market-workspace",
  "private": true,
  "type": "module",
  "workspaces": ["client", "worker", "app"],
  "scripts": {
    "test:local": "anchor test",
    "test:devnet": "tsx tests/devnet/e2e.ts"
  },
  "devDependencies": {
    "@coral-xyz/anchor": "0.32.1",
    "@magicblock-labs/ephemeral-rollups-sdk": "0.15.5",
    "@solana/web3.js": "^1.98.0",
    "@noble/hashes": "^1.5.0",
    "bs58": "^6.0.0",
    "tweetnacl": "^1.0.3",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["tests/**/*.ts", "client/src/**/*.ts"]
}
```

Run `npm install` at the root.

- [ ] **Step 5: Write `src/state.rs`**

```rust
use anchor_lang::prelude::*;

pub const PROVIDER_SEED: &[u8] = b"provider";
pub const JOB_SEED: &[u8] = b"job";
pub const JOB_PRIVATE_SEED: &[u8] = b"job-private";
pub const ESCROW_SEED: &[u8] = b"escrow";

pub const PROMPT_MAX: usize = 4096;
pub const OUTPUT_MAX: usize = 5120;
pub const CHUNK_MAX: usize = 900;
pub const MODEL_LABEL_LEN: usize = 32;
pub const MAX_PERMISSION_MEMBERS: usize = 2;
pub const MIN_DEADLINE_SECS: i64 = 60;
pub const ACTION_ESCROW_INDEX: u8 = 255;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum JobStatus {
    Created,
    Open,
    Claimed,
    Submitted,
    Approved,
    Rejected,
    Cancelled,
    Expired,
}

impl JobStatus {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            JobStatus::Approved | JobStatus::Rejected | JobStatus::Cancelled | JobStatus::Expired
        )
    }
}

#[account]
#[derive(InitSpace)]
pub struct Provider {
    pub authority: Pubkey,
    pub model_label: [u8; MODEL_LABEL_LEN],
    pub completed: u32,
    pub rejected: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Job {
    pub requester: Pubkey,
    pub provider: Pubkey,
    pub nonce: u64,
    pub status: JobStatus,
    pub price_lamports: u64,
    pub deadline_unix: i64,
    pub model_label: [u8; MODEL_LABEL_LEN],
    pub prompt_hash: [u8; 32],
    pub output_hash: [u8; 32],
    pub created_at: i64,
    pub claimed_at: i64,
    pub submitted_at: i64,
    pub bump: u8,
}

/// Zero-copy: ~9 KB buffer written in chunks. Field order avoids interior padding.
#[account(zero_copy)]
#[repr(C)]
pub struct JobPrivate {
    pub job: Pubkey,
    pub prompt: [u8; PROMPT_MAX],
    pub output: [u8; OUTPUT_MAX],
    pub prompt_len: u16,
    pub output_len: u16,
    pub bump: u8,
    pub _pad: [u8; 1],
}

impl JobPrivate {
    pub const SPACE: usize = 8 + core::mem::size_of::<JobPrivate>();

    pub fn scrub(&mut self) {
        self.prompt = [0u8; PROMPT_MAX];
        self.output = [0u8; OUTPUT_MAX];
        self.prompt_len = 0;
        self.output_len = 0;
    }
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub job: Pubkey,
    pub amount: u64,
    pub paid: bool,
    pub bump: u8,
}
```

- [ ] **Step 6: Write `src/errors.rs`**

```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum MarketError {
    #[msg("Invalid status transition")]
    InvalidTransition,
    #[msg("Signer is not authorized for this action")]
    Unauthorized,
    #[msg("Deadline must be at least MIN_DEADLINE_SECS in the future")]
    DeadlineTooSoon,
    #[msg("Price must be greater than zero")]
    ZeroPrice,
    #[msg("Chunk exceeds CHUNK_MAX bytes")]
    ChunkTooLarge,
    #[msg("Chunk write out of bounds")]
    ChunkOutOfBounds,
    #[msg("Payload is empty")]
    EmptyPayload,
    #[msg("Finalize length exceeds bytes written")]
    LengthExceedsWritten,
    #[msg("Permission member count exceeds MAX_PERMISSION_MEMBERS")]
    TooManyMembers,
    #[msg("Escrow already settled")]
    AlreadySettled,
    #[msg("Job is still delegated; wait for undelegation")]
    JobStillDelegated,
    #[msg("Job is not in a terminal status")]
    NotTerminal,
    #[msg("Recipient account does not match job")]
    WrongRecipient,
    #[msg("Provider account does not match job.provider")]
    WrongProviderAccount,
    #[msg("Escrow does not belong to this job")]
    EscrowJobMismatch,
    #[msg("Escrow has not been paid out yet")]
    NotPaid,
}
```

- [ ] **Step 7: Write `src/lib.rs` skeleton and `src/instructions/mod.rs`, then build and set the program ID**

```rust
// src/lib.rs
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod errors;
pub mod instructions;
pub mod logic;
pub mod state;

declare_id!("11111111111111111111111111111111");

#[ephemeral]
#[program]
pub mod inference_market {
    use super::*;
}
```

```rust
// src/instructions/mod.rs  (empty for now; filled by later tasks)
```

```rust
// src/logic.rs  (placeholder module so lib.rs compiles; Task 2 fills it)
```

```bash
anchor build
anchor keys sync
anchor build
grep inference_market Anchor.toml
```
Expected: second build succeeds; `Anchor.toml` and `declare_id!` now hold the real program ID (replace `REPLACED_IN_STEP_7` for both localnet and devnet with that ID if `keys sync` did not).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: anchor workspace, account state, errors"
```

---

### Task 2: Pure logic with cargo unit tests

**Files:**
- Create: `programs/inference_market/src/logic.rs` (replace placeholder)

**Interfaces:**
- Produces:
  - `pub fn check_transition(from: JobStatus, to: JobStatus, now: i64, deadline: i64) -> Result<()>`
  - `pub enum Recipient { Provider, Requester }` and `pub fn settle_recipient(status: JobStatus) -> Result<Recipient>`
  - `pub fn write_chunk(buf: &mut [u8], cur_len: u16, offset: u16, data: &[u8]) -> Result<u16>` returns new length (max of old and offset+len)
  - `pub fn hash_bytes(bytes: &[u8]) -> [u8; 32]`

- [ ] **Step 1: Write the failing tests inside `logic.rs`**

```rust
use anchor_lang::prelude::*;

use crate::errors::MarketError;
use crate::state::{JobStatus, CHUNK_MAX};

pub enum Recipient {
    Provider,
    Requester,
}

pub fn check_transition(from: JobStatus, to: JobStatus, now: i64, deadline: i64) -> Result<()> {
    todo!()
}

pub fn settle_recipient(status: JobStatus) -> Result<Recipient> {
    todo!()
}

pub fn write_chunk(buf: &mut [u8], cur_len: u16, offset: u16, data: &[u8]) -> Result<u16> {
    todo!()
}

pub fn hash_bytes(bytes: &[u8]) -> [u8; 32] {
    anchor_lang::solana_program::hash::hash(bytes).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use JobStatus::*;

    #[test]
    fn happy_path_transitions() {
        assert!(check_transition(Created, Open, 100, 1000).is_ok());
        assert!(check_transition(Open, Claimed, 100, 1000).is_ok());
        assert!(check_transition(Claimed, Submitted, 100, 1000).is_ok());
        assert!(check_transition(Submitted, Approved, 100, 1000).is_ok());
        assert!(check_transition(Submitted, Rejected, 100, 1000).is_ok());
    }

    #[test]
    fn cancel_only_before_claim() {
        assert!(check_transition(Created, Cancelled, 100, 1000).is_ok());
        assert!(check_transition(Open, Cancelled, 100, 1000).is_ok());
        assert!(check_transition(Claimed, Cancelled, 100, 1000).is_err());
        assert!(check_transition(Submitted, Cancelled, 100, 1000).is_err());
    }

    #[test]
    fn expire_only_after_deadline_and_before_submission() {
        assert!(check_transition(Open, Expired, 1000, 1000).is_ok());
        assert!(check_transition(Claimed, Expired, 1001, 1000).is_ok());
        assert!(check_transition(Claimed, Expired, 999, 1000).is_err());
        assert!(check_transition(Submitted, Expired, 5000, 1000).is_err());
    }

    #[test]
    fn claim_and_submit_rejected_after_deadline() {
        assert!(check_transition(Open, Claimed, 1000, 1000).is_err());
        assert!(check_transition(Claimed, Submitted, 1000, 1000).is_err());
    }

    #[test]
    fn terminal_states_are_sinks() {
        for s in [Approved, Rejected, Cancelled, Expired] {
            for t in [Created, Open, Claimed, Submitted, Approved, Rejected, Cancelled, Expired] {
                assert!(check_transition(s, t, 0, 1000).is_err());
            }
        }
    }

    #[test]
    fn recipient_by_status() {
        assert!(matches!(settle_recipient(Approved).unwrap(), Recipient::Provider));
        assert!(matches!(settle_recipient(Rejected).unwrap(), Recipient::Requester));
        assert!(matches!(settle_recipient(Cancelled).unwrap(), Recipient::Requester));
        assert!(matches!(settle_recipient(Expired).unwrap(), Recipient::Requester));
        assert!(settle_recipient(Submitted).is_err());
    }

    #[test]
    fn write_chunk_appends_and_tracks_len() {
        let mut buf = [0u8; 32];
        let len = write_chunk(&mut buf, 0, 0, b"hello").unwrap();
        assert_eq!(len, 5);
        let len = write_chunk(&mut buf, len, 5, b" world").unwrap();
        assert_eq!(len, 11);
        assert_eq!(&buf[..11], b"hello world");
        // overwrite in the middle keeps the larger length
        let len = write_chunk(&mut buf, len, 0, b"J").unwrap();
        assert_eq!(len, 11);
        assert_eq!(&buf[..11], b"Jello world");
    }

    #[test]
    fn write_chunk_rejects_bad_input() {
        let mut buf = [0u8; 32];
        assert!(write_chunk(&mut buf, 0, 30, b"abc").is_err()); // out of bounds
        assert!(write_chunk(&mut buf, 0, 0, b"").is_err()); // empty
        let big = vec![1u8; CHUNK_MAX + 1];
        let mut big_buf = vec![0u8; CHUNK_MAX + 10];
        assert!(write_chunk(&mut big_buf, 0, 0, &big).is_err()); // too large
    }

    #[test]
    fn hash_is_sha256() {
        let h = hash_bytes(b"abc");
        assert_eq!(
            h[..4],
            [0xba, 0x78, 0x16, 0xbf]
        );
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cargo test -p inference_market --lib
```
Expected: panics with `not yet implemented`.

- [ ] **Step 3: Implement**

Replace the three `todo!()` bodies:

```rust
pub fn check_transition(from: JobStatus, to: JobStatus, now: i64, deadline: i64) -> Result<()> {
    use JobStatus::*;
    let ok = match (from, to) {
        (Created, Open) => true,
        (Open, Claimed) => now < deadline,
        (Claimed, Submitted) => now < deadline,
        (Submitted, Approved) | (Submitted, Rejected) => true,
        (Created, Cancelled) | (Open, Cancelled) => true,
        (Open, Expired) | (Claimed, Expired) => now >= deadline,
        _ => false,
    };
    require!(ok, MarketError::InvalidTransition);
    Ok(())
}

pub fn settle_recipient(status: JobStatus) -> Result<Recipient> {
    use JobStatus::*;
    match status {
        Approved => Ok(Recipient::Provider),
        Rejected | Cancelled | Expired => Ok(Recipient::Requester),
        _ => err!(MarketError::NotTerminal),
    }
}

pub fn write_chunk(buf: &mut [u8], cur_len: u16, offset: u16, data: &[u8]) -> Result<u16> {
    require!(!data.is_empty(), MarketError::EmptyPayload);
    require!(data.len() <= CHUNK_MAX, MarketError::ChunkTooLarge);
    let start = offset as usize;
    let end = start
        .checked_add(data.len())
        .ok_or(MarketError::ChunkOutOfBounds)?;
    require!(end <= buf.len(), MarketError::ChunkOutOfBounds);
    buf[start..end].copy_from_slice(data);
    Ok(core::cmp::max(cur_len as usize, end) as u16)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test -p inference_market --lib
```
Expected: `test result: ok. 9 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: pure job logic with unit tests"
```

---

### Task 3: Base instructions `register_provider` and `create_job`

**Files:**
- Create: `src/instructions/register_provider.rs`, `src/instructions/create_job.rs`
- Modify: `src/instructions/mod.rs`, `src/lib.rs`
- Test: `tests/inference_market.ts`

**Interfaces:**
- Produces instructions `register_provider(model_label: [u8;32])` and `create_job(nonce: u64, price_lamports: u64, deadline_unix: i64, model_label: [u8;32])`, plus `JobCreated` event `{ job, requester, price_lamports, deadline_unix, model_label }`.

- [ ] **Step 1: Write the failing local test**

```ts
// tests/inference_market.ts
import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.InferenceMarket as anchor.Program;
const wallet = provider.wallet as anchor.Wallet;

const label = (s: string) => { const b = Buffer.alloc(32); b.write(s); return [...b]; };
const u64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };

const providerPda = (w: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("provider"), w.toBuffer()], program.programId)[0];
const jobPda = (r: PublicKey, nonce: bigint) =>
  PublicKey.findProgramAddressSync([Buffer.from("job"), r.toBuffer(), u64le(nonce)], program.programId)[0];
const jobPrivatePda = (job: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("job-private"), job.toBuffer()], program.programId)[0];
const escrowPda = (job: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("escrow"), job.toBuffer()], program.programId)[0];

test("register_provider creates the PDA", async () => {
  await program.methods.registerProvider(label("llama3.2:1b"))
    .accounts({ authority: wallet.publicKey, providerAccount: providerPda(wallet.publicKey), systemProgram: SystemProgram.programId })
    .rpc();
  const acc: any = await program.account.provider.fetch(providerPda(wallet.publicKey));
  assert.equal(acc.authority.toBase58(), wallet.publicKey.toBase58());
  assert.equal(acc.completed, 0);
});

test("create_job funds escrow and pre-funds permission rent", async () => {
  const nonce = 1n;
  const job = jobPda(wallet.publicKey, nonce);
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const price = 0.01 * LAMPORTS_PER_SOL;
  await program.methods.createJob(new anchor.BN(nonce.toString()), new anchor.BN(price), new anchor.BN(deadline), label("llama3.2:1b"))
    .accounts({ requester: wallet.publicKey, job, jobPrivate: jobPrivatePda(job), escrow: escrowPda(job), systemProgram: SystemProgram.programId })
    .rpc();
  const j: any = await program.account.job.fetch(job);
  assert.deepEqual(j.status, { created: {} });
  assert.equal(j.priceLamports.toNumber(), price);
  const e: any = await program.account.escrow.fetch(escrowPda(job));
  assert.equal(e.amount.toNumber(), price);
  assert.equal(e.paid, false);
  const escrowLamports = await provider.connection.getBalance(escrowPda(job));
  assert.ok(escrowLamports >= price);
  const jpInfo = await provider.connection.getAccountInfo(jobPrivatePda(job));
  assert.ok(jpInfo && jpInfo.data.length >= 8 + 32 + 4096 + 5120 + 6);
});

test("create_job rejects zero price and short deadline", async () => {
  const nonce = 2n;
  const job = jobPda(wallet.publicKey, nonce);
  const accounts = { requester: wallet.publicKey, job, jobPrivate: jobPrivatePda(job), escrow: escrowPda(job), systemProgram: SystemProgram.programId };
  await assert.rejects(
    program.methods.createJob(new anchor.BN(2), new anchor.BN(0), new anchor.BN(Math.floor(Date.now()/1000)+3600), label("x")).accounts(accounts).rpc(),
    /ZeroPrice/);
  await assert.rejects(
    program.methods.createJob(new anchor.BN(2), new anchor.BN(1000), new anchor.BN(Math.floor(Date.now()/1000)+10), label("x")).accounts(accounts).rpc(),
    /DeadlineTooSoon/);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
anchor test
```
Expected: fails with `program.methods.registerProvider is not a function`.

- [ ] **Step 3: Implement `register_provider.rs`**

```rust
use anchor_lang::prelude::*;

use crate::state::{Provider, MODEL_LABEL_LEN, PROVIDER_SEED};

#[derive(Accounts)]
pub struct RegisterProvider<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Provider::INIT_SPACE,
        seeds = [PROVIDER_SEED, authority.key().as_ref()],
        bump
    )]
    pub provider_account: Account<'info, Provider>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RegisterProvider>, model_label: [u8; MODEL_LABEL_LEN]) -> Result<()> {
    let p = &mut ctx.accounts.provider_account;
    p.authority = ctx.accounts.authority.key();
    p.model_label = model_label;
    p.completed = 0;
    p.rejected = 0;
    p.bump = ctx.bumps.provider_account;
    Ok(())
}
```

- [ ] **Step 4: Implement `create_job.rs`**

```rust
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::access_control::structs::EphemeralPermission;

use crate::errors::MarketError;
use crate::state::*;

#[event]
pub struct JobCreated {
    pub job: Pubkey,
    pub requester: Pubkey,
    pub price_lamports: u64,
    pub deadline_unix: i64,
    pub model_label: [u8; MODEL_LABEL_LEN],
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateJob<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,
    #[account(
        init,
        payer = requester,
        space = 8 + Job::INIT_SPACE,
        seeds = [JOB_SEED, requester.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub job: Account<'info, Job>,
    #[account(
        init,
        payer = requester,
        space = JobPrivate::SPACE,
        seeds = [JOB_PRIVATE_SEED, job.key().as_ref()],
        bump
    )]
    pub job_private: AccountLoader<'info, JobPrivate>,
    #[account(
        init,
        payer = requester,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [ESCROW_SEED, job.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateJob>,
    nonce: u64,
    price_lamports: u64,
    deadline_unix: i64,
    model_label: [u8; MODEL_LABEL_LEN],
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(price_lamports > 0, MarketError::ZeroPrice);
    require!(deadline_unix >= now + MIN_DEADLINE_SECS, MarketError::DeadlineTooSoon);

    let job_key = ctx.accounts.job.key();
    {
        let job = &mut ctx.accounts.job;
        job.requester = ctx.accounts.requester.key();
        job.provider = Pubkey::default();
        job.nonce = nonce;
        job.status = JobStatus::Created;
        job.price_lamports = price_lamports;
        job.deadline_unix = deadline_unix;
        job.model_label = model_label;
        job.prompt_hash = [0u8; 32];
        job.output_hash = [0u8; 32];
        job.created_at = now;
        job.claimed_at = 0;
        job.submitted_at = 0;
        job.bump = ctx.bumps.job;
    }
    {
        let mut jp = ctx.accounts.job_private.load_init()?;
        jp.job = job_key;
        jp.prompt_len = 0;
        jp.output_len = 0;
        jp.bump = ctx.bumps.job_private;
    }
    {
        let escrow = &mut ctx.accounts.escrow;
        escrow.job = job_key;
        escrow.amount = price_lamports;
        escrow.paid = false;
        escrow.bump = ctx.bumps.escrow;
    }

    // Fund escrow with the price.
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.requester.to_account_info(),
                to: ctx.accounts.escrow.to_account_info(),
            },
        ),
        price_lamports,
    )?;

    // Pre-fund permission rent: the delegated PDAs pay for their ER-local permissions.
    let job_perm_rent =
        ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(0) as u32);
    let private_perm_rent = ephemeral_rollups_sdk::ephemeral_accounts::rent(
        EphemeralPermission::size_of(MAX_PERMISSION_MEMBERS) as u32,
    );
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.requester.to_account_info(),
                to: ctx.accounts.job.to_account_info(),
            },
        ),
        job_perm_rent,
    )?;
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.requester.to_account_info(),
                to: ctx.accounts.job_private.to_account_info(),
            },
        ),
        private_perm_rent,
    )?;

    emit!(JobCreated {
        job: job_key,
        requester: ctx.accounts.requester.key(),
        price_lamports,
        deadline_unix,
        model_label,
    });
    Ok(())
}
```

If `ephemeral_rollups_sdk::ephemeral_accounts::rent` does not exist under that path in 0.16.2, grep the crate source (`~/.cargo/registry/src/*/ephemeral-rollups-sdk-0.16.2/src`) for `pub fn rent` and use the actual path; do not compute rent by hand.

- [ ] **Step 5: Wire `mod.rs` and `lib.rs`**

```rust
// src/instructions/mod.rs
pub mod create_job;
pub mod register_provider;

pub use create_job::*;
pub use register_provider::*;
```

```rust
// src/lib.rs (inside `pub mod inference_market`)
    pub fn register_provider(
        ctx: Context<RegisterProvider>,
        model_label: [u8; state::MODEL_LABEL_LEN],
    ) -> Result<()> {
        instructions::register_provider::handler(ctx, model_label)
    }

    pub fn create_job(
        ctx: Context<CreateJob>,
        nonce: u64,
        price_lamports: u64,
        deadline_unix: i64,
        model_label: [u8; state::MODEL_LABEL_LEN],
    ) -> Result<()> {
        instructions::create_job::handler(ctx, nonce, price_lamports, deadline_unix, model_label)
    }
```
Add `use instructions::*;` under `use super::*;` in the program module.

- [ ] **Step 6: Run tests to verify they pass**

```bash
anchor build && anchor test
```
Expected: 3 passing.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: register_provider and create_job with escrow and permission rent"
```

---

### Task 4: Delegation instructions

**Files:**
- Create: `src/instructions/delegate_job.rs`
- Modify: `src/instructions/mod.rs`, `src/lib.rs`, `tests/inference_market.ts`

**Interfaces:**
- Produces `delegate_job(nonce: u64)` and `delegate_job_private(nonce: u64)`, each with an optional `validator` account. Client must pass the `#[delegate]`-injected accounts (`buffer_job`, `delegation_record_job`, `delegation_metadata_job`, `owner_program`, `delegation_program`, `system_program`; names as emitted in the IDL after build).

- [ ] **Step 1: Write the failing test (append to `tests/inference_market.ts`)**

```ts
import {
  DELEGATION_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";

test("delegate_job and delegate_job_private lock both PDAs under the delegation program", async () => {
  const nonce = 1n;
  const job = jobPda(wallet.publicKey, nonce);
  const jp = jobPrivatePda(job);
  const delAccounts = (acct: PublicKey) => ({
    bufferAcct: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(acct, program.programId),
    record: delegationRecordPdaFromDelegatedAccount(acct),
    meta: delegationMetadataPdaFromDelegatedAccount(acct),
  });
  const dj = delAccounts(job);
  const dp = delAccounts(jp);
  const tx = new anchor.web3.Transaction()
    .add(await program.methods.delegateJob(new anchor.BN(1)).accounts({
      requester: wallet.publicKey, job, validator: null,
      bufferJob: dj.bufferAcct, delegationRecordJob: dj.record, delegationMetadataJob: dj.meta,
      ownerProgram: program.programId, delegationProgram: DELEGATION_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).instruction())
    .add(await program.methods.delegateJobPrivate(new anchor.BN(1)).accounts({
      requester: wallet.publicKey, job, jobPrivate: jp, validator: null,
      bufferJobPrivate: dp.bufferAcct, delegationRecordJobPrivate: dp.record, delegationMetadataJobPrivate: dp.meta,
      ownerProgram: program.programId, delegationProgram: DELEGATION_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).instruction());
  await provider.sendAndConfirm(tx);
  const jobInfo = await provider.connection.getAccountInfo(job);
  const jpInfo = await provider.connection.getAccountInfo(jp);
  assert.equal(jobInfo!.owner.toBase58(), DELEGATION_PROGRAM_ID.toBase58());
  assert.equal(jpInfo!.owner.toBase58(), DELEGATION_PROGRAM_ID.toBase58());
});
```
After the first build, open `target/idl/inference_market.json`, find the two delegate instructions, and correct the injected account names in this test to match the IDL exactly (the macro's naming is `buffer_<field>`, `delegation_record_<field>`, `delegation_metadata_<field>`; Anchor camel-cases them in TS).

- [ ] **Step 2: Run to verify it fails**

```bash
anchor test
```
Expected: `delegateJob is not a function`.

- [ ] **Step 3: Implement `delegate_job.rs`**

```rust
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::state::{JOB_PRIVATE_SEED, JOB_SEED};

#[delegate]
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct DelegateJob<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,
    /// CHECK: delegated PDA; seeds bind it to the signer.
    #[account(mut, del, seeds = [JOB_SEED, requester.key().as_ref(), &nonce.to_le_bytes()], bump)]
    pub job: AccountInfo<'info>,
    /// CHECK: optional TEE validator identity forwarded in DelegateConfig.
    pub validator: Option<UncheckedAccount<'info>>,
}

pub fn delegate_job(ctx: Context<DelegateJob>, nonce: u64) -> Result<()> {
    let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
    ctx.accounts.delegate_job(
        &ctx.accounts.requester,
        &[JOB_SEED, ctx.accounts.requester.key().as_ref(), &nonce.to_le_bytes()],
        DelegateConfig { validator, ..Default::default() },
    )?;
    Ok(())
}

#[delegate]
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct DelegateJobPrivate<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,
    /// CHECK: only used to derive job_private's seed; ownership may already be the delegation program.
    #[account(seeds = [JOB_SEED, requester.key().as_ref(), &nonce.to_le_bytes()], bump)]
    pub job: UncheckedAccount<'info>,
    /// CHECK: delegated PDA.
    #[account(mut, del, seeds = [JOB_PRIVATE_SEED, job.key().as_ref()], bump)]
    pub job_private: AccountInfo<'info>,
    /// CHECK: optional TEE validator identity.
    pub validator: Option<UncheckedAccount<'info>>,
}

pub fn delegate_job_private(ctx: Context<DelegateJobPrivate>, _nonce: u64) -> Result<()> {
    let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
    let job_key = ctx.accounts.job.key();
    ctx.accounts.delegate_job_private(
        &ctx.accounts.requester,
        &[JOB_PRIVATE_SEED, job_key.as_ref()],
        DelegateConfig { validator, ..Default::default() },
    )?;
    Ok(())
}
```

Wire in `mod.rs` (`pub mod delegate_job; pub use delegate_job::*;`) and `lib.rs`:

```rust
    pub fn delegate_job(ctx: Context<DelegateJob>, nonce: u64) -> Result<()> {
        instructions::delegate_job::delegate_job(ctx, nonce)
    }
    pub fn delegate_job_private(ctx: Context<DelegateJobPrivate>, nonce: u64) -> Result<()> {
        instructions::delegate_job::delegate_job_private(ctx, nonce)
    }
```

- [ ] **Step 4: Build, fix IDL account names in the test, run**

```bash
anchor build && node -e 'const i=require("./target/idl/inference_market.json");for(const x of i.instructions)if(x.name.startsWith("delegate"))console.log(x.name,x.accounts.map(a=>a.name))'
anchor test
```
Expected: 4 passing. If the local validator rejects the delegation CPI with an unknown-account error for a fee vault, add `[[test.validator.clone]]` entries for any account named in the error and retry.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: delegate_job and delegate_job_private with optional TEE validator"
```

---

### Task 5: ER instructions — permissions, prompt, claim, output

**Files:**
- Create: `src/instructions/permissions.rs`, `src/instructions/prompt.rs`, `src/instructions/claim.rs`, `src/instructions/output.rs`
- Modify: `src/instructions/mod.rs`, `src/lib.rs`

**Interfaces:**
- Produces: `init_permissions()`, `write_prompt(offset: u16, data: Vec<u8>)`, `finalize_prompt(len: u16)`, `claim_job()`, `write_output(offset: u16, data: Vec<u8>)`, `finalize_output(len: u16)`. All run on the TEE ER only. Account names are used verbatim by the client in Task 8.
- Consumes: `logic::check_transition`, `logic::write_chunk`, `logic::hash_bytes`.

These cannot be exercised on a plain local validator (permission CPIs target ER-only programs). Verification for this task is `anchor build` plus `cargo test`; behavior is proven in Task 9 on devnet.

- [ ] **Step 1: Write `permissions.rs`**

```rust
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::CreateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::{
    EphemeralMembersArgs, Member, PERMISSION_SEED, TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};

use crate::state::*;

pub const MEMBER_FLAGS: u8 = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;

#[derive(Accounts)]
pub struct InitPermissions<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,
    #[account(
        mut,
        seeds = [JOB_SEED, requester.key().as_ref(), &job.nonce.to_le_bytes()],
        bump = job.bump,
        has_one = requester
    )]
    pub job: Account<'info, Job>,
    #[account(mut, seeds = [JOB_PRIVATE_SEED, job.key().as_ref()], bump)]
    pub job_private: AccountLoader<'info, JobPrivate>,
    /// CHECK: permission PDA for `job`, derived under the Permission Program.
    #[account(mut, seeds = [PERMISSION_SEED, job.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub job_permission: UncheckedAccount<'info>,
    /// CHECK: permission PDA for `job_private`.
    #[account(mut, seeds = [PERMISSION_SEED, job_private.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub job_private_permission: UncheckedAccount<'info>,
    /// CHECK: fixed program id.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed vault.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed program id.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<InitPermissions>) -> Result<()> {
    let requester = ctx.accounts.requester.key();
    let nonce_bytes = ctx.accounts.job.nonce.to_le_bytes();
    let job_bump = [ctx.accounts.job.bump];
    let job_seeds: &[&[u8]] = &[JOB_SEED, requester.as_ref(), &nonce_bytes, &job_bump];

    if ctx.accounts.job_permission.lamports() == 0 {
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.job.to_account_info(),
            permissioned_account: ctx.accounts.job.to_account_info(),
            permission: ctx.accounts.job_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs { is_private: false, members: vec![] },
        }
        .invoke_signed(&[job_seeds])?;
    }

    let job_key = ctx.accounts.job.key();
    let jp_bump = [ctx.bumps.job_private];
    let jp_seeds: &[&[u8]] = &[JOB_PRIVATE_SEED, job_key.as_ref(), &jp_bump];

    if ctx.accounts.job_private_permission.lamports() == 0 {
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.job_private.to_account_info(),
            permissioned_account: ctx.accounts.job_private.to_account_info(),
            permission: ctx.accounts.job_private_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![Member { flags: MEMBER_FLAGS, pubkey: requester }],
            },
        }
        .invoke_signed(&[jp_seeds])?;
    }
    Ok(())
}
```

- [ ] **Step 2: Write `prompt.rs`**

```rust
use anchor_lang::prelude::*;

use crate::errors::MarketError;
use crate::logic::{check_transition, hash_bytes, write_chunk};
use crate::state::*;

#[derive(Accounts)]
pub struct PromptCtx<'info> {
    pub requester: Signer<'info>,
    #[account(
        mut,
        seeds = [JOB_SEED, requester.key().as_ref(), &job.nonce.to_le_bytes()],
        bump = job.bump,
        has_one = requester
    )]
    pub job: Account<'info, Job>,
    #[account(mut, seeds = [JOB_PRIVATE_SEED, job.key().as_ref()], bump)]
    pub job_private: AccountLoader<'info, JobPrivate>,
}

pub fn write_prompt(ctx: Context<PromptCtx>, offset: u16, data: Vec<u8>) -> Result<()> {
    require!(ctx.accounts.job.status == JobStatus::Created, MarketError::InvalidTransition);
    let mut jp = ctx.accounts.job_private.load_mut()?;
    let cur = jp.prompt_len;
    jp.prompt_len = write_chunk(&mut jp.prompt, cur, offset, &data)?;
    Ok(())
}

pub fn finalize_prompt(ctx: Context<PromptCtx>, len: u16) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let job = &mut ctx.accounts.job;
    check_transition(job.status, JobStatus::Open, now, job.deadline_unix)?;
    require!(len > 0, MarketError::EmptyPayload);
    let mut jp = ctx.accounts.job_private.load_mut()?;
    require!(len <= jp.prompt_len, MarketError::LengthExceedsWritten);
    jp.prompt_len = len;
    job.prompt_hash = hash_bytes(&jp.prompt[..len as usize]);
    job.status = JobStatus::Open;
    Ok(())
}
```

- [ ] **Step 3: Write `claim.rs`**

```rust
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::UpdateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::{EphemeralMembersArgs, Member, PERMISSION_SEED};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};

use crate::errors::MarketError;
use crate::instructions::permissions::MEMBER_FLAGS;
use crate::logic::check_transition;
use crate::state::*;

#[derive(Accounts)]
pub struct ClaimJob<'info> {
    #[account(mut)]
    pub provider: Signer<'info>,
    #[account(
        seeds = [PROVIDER_SEED, provider.key().as_ref()],
        bump = provider_account.bump,
        constraint = provider_account.authority == provider.key() @ MarketError::Unauthorized
    )]
    pub provider_account: Account<'info, Provider>,
    #[account(mut, seeds = [JOB_SEED, job.requester.as_ref(), &job.nonce.to_le_bytes()], bump = job.bump)]
    pub job: Account<'info, Job>,
    #[account(mut, seeds = [JOB_PRIVATE_SEED, job.key().as_ref()], bump)]
    pub job_private: AccountLoader<'info, JobPrivate>,
    /// CHECK: permission PDA for job_private.
    #[account(mut, seeds = [PERMISSION_SEED, job_private.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub job_private_permission: UncheckedAccount<'info>,
    /// CHECK: fixed.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<ClaimJob>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let job = &mut ctx.accounts.job;
    check_transition(job.status, JobStatus::Claimed, now, job.deadline_unix)?;
    require!(job.provider == Pubkey::default(), MarketError::InvalidTransition);
    job.provider = ctx.accounts.provider.key();
    job.claimed_at = now;
    job.status = JobStatus::Claimed;

    let members = vec![
        Member { flags: MEMBER_FLAGS, pubkey: job.requester },
        Member { flags: MEMBER_FLAGS, pubkey: job.provider },
    ];
    require!(members.len() <= MAX_PERMISSION_MEMBERS, MarketError::TooManyMembers);

    let job_key = job.key();
    let jp_bump = [ctx.bumps.job_private];
    let jp_seeds: &[&[u8]] = &[JOB_PRIVATE_SEED, job_key.as_ref(), &jp_bump];
    UpdateEphemeralPermissionCpi {
        payer: ctx.accounts.job_private.to_account_info(),
        permissioned_account: ctx.accounts.job_private.to_account_info(),
        permission: ctx.accounts.job_private_permission.to_account_info(),
        vault: ctx.accounts.ephemeral_vault.to_account_info(),
        magic_program: ctx.accounts.magic_program.to_account_info(),
        permission_program: ctx.accounts.permission_program.to_account_info(),
        authority: ctx.accounts.job_private.to_account_info(),
        authority_is_signer: false,
        args: EphemeralMembersArgs { is_private: true, members },
    }
    .invoke_signed(&[jp_seeds])?;
    Ok(())
}
```

- [ ] **Step 4: Write `output.rs`**

```rust
use anchor_lang::prelude::*;

use crate::errors::MarketError;
use crate::logic::{check_transition, hash_bytes, write_chunk};
use crate::state::*;

#[derive(Accounts)]
pub struct OutputCtx<'info> {
    pub provider: Signer<'info>,
    #[account(
        mut,
        seeds = [JOB_SEED, job.requester.as_ref(), &job.nonce.to_le_bytes()],
        bump = job.bump,
        constraint = job.provider == provider.key() @ MarketError::Unauthorized
    )]
    pub job: Account<'info, Job>,
    #[account(mut, seeds = [JOB_PRIVATE_SEED, job.key().as_ref()], bump)]
    pub job_private: AccountLoader<'info, JobPrivate>,
}

pub fn write_output(ctx: Context<OutputCtx>, offset: u16, data: Vec<u8>) -> Result<()> {
    require!(ctx.accounts.job.status == JobStatus::Claimed, MarketError::InvalidTransition);
    let mut jp = ctx.accounts.job_private.load_mut()?;
    let cur = jp.output_len;
    jp.output_len = write_chunk(&mut jp.output, cur, offset, &data)?;
    Ok(())
}

pub fn finalize_output(ctx: Context<OutputCtx>, len: u16) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let job = &mut ctx.accounts.job;
    check_transition(job.status, JobStatus::Submitted, now, job.deadline_unix)?;
    require!(len > 0, MarketError::EmptyPayload);
    let mut jp = ctx.accounts.job_private.load_mut()?;
    require!(len <= jp.output_len, MarketError::LengthExceedsWritten);
    jp.output_len = len;
    job.output_hash = hash_bytes(&jp.output[..len as usize]);
    job.submitted_at = now;
    job.status = JobStatus::Submitted;
    Ok(())
}
```

- [ ] **Step 5: Wire `mod.rs` and `lib.rs`**

```rust
// mod.rs additions
pub mod claim;
pub mod output;
pub mod permissions;
pub mod prompt;
pub use claim::*;
pub use output::*;
pub use permissions::*;
pub use prompt::*;
```

```rust
// lib.rs additions inside the program module
    pub fn init_permissions(ctx: Context<InitPermissions>) -> Result<()> {
        instructions::permissions::handler(ctx)
    }
    pub fn write_prompt(ctx: Context<PromptCtx>, offset: u16, data: Vec<u8>) -> Result<()> {
        instructions::prompt::write_prompt(ctx, offset, data)
    }
    pub fn finalize_prompt(ctx: Context<PromptCtx>, len: u16) -> Result<()> {
        instructions::prompt::finalize_prompt(ctx, len)
    }
    pub fn claim_job(ctx: Context<ClaimJob>) -> Result<()> {
        instructions::claim::handler(ctx)
    }
    pub fn write_output(ctx: Context<OutputCtx>, offset: u16, data: Vec<u8>) -> Result<()> {
        instructions::output::write_output(ctx, offset, data)
    }
    pub fn finalize_output(ctx: Context<OutputCtx>, len: u16) -> Result<()> {
        instructions::output::finalize_output(ctx, len)
    }
```

- [ ] **Step 6: Build and run unit tests**

```bash
anchor build && cargo test -p inference_market --lib && anchor test
```
Expected: build OK, 9 cargo tests pass, 4 anchor tests still pass.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: ER instructions for permissions, chunked prompt/output, claim"
```

---

### Task 6: Terminal instructions, settle, close_job

**Files:**
- Create: `src/instructions/finish.rs`, `src/instructions/settle.rs`, `src/instructions/close_job.rs`
- Modify: `src/instructions/mod.rs`, `src/lib.rs`, `tests/inference_market.ts`

**Interfaces:**
- Produces: `approve_job(schedule_action: bool)`, `reject_job(schedule_action: bool)`, `cancel_job(schedule_action: bool)`, `expire_job(schedule_action: bool)` (ER); `settle_action()` (`#[action]`, base), `settle_direct()` (base, permissionless); `close_job()` (base).
- Consumes: `logic::check_transition`, `logic::settle_recipient`, `JobPrivate::scrub`.

- [ ] **Step 1: Write `finish.rs`**

```rust
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::CloseEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::PERMISSION_SEED;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::ephem::{CallHandler, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};

use crate::errors::MarketError;
use crate::logic::check_transition;
use crate::state::*;

#[commit]
#[derive(Accounts)]
pub struct FinishJob<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut, seeds = [JOB_SEED, job.requester.as_ref(), &job.nonce.to_le_bytes()], bump = job.bump)]
    pub job: Account<'info, Job>,
    #[account(mut, seeds = [JOB_PRIVATE_SEED, job.key().as_ref()], bump)]
    pub job_private: AccountLoader<'info, JobPrivate>,
    /// CHECK: permission PDA for job.
    #[account(mut, seeds = [PERMISSION_SEED, job.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub job_permission: UncheckedAccount<'info>,
    /// CHECK: permission PDA for job_private.
    #[account(mut, seeds = [PERMISSION_SEED, job_private.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub job_private_permission: UncheckedAccount<'info>,
    /// CHECK: fixed.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: base escrow PDA; only its key is used, for the scheduled action.
    #[account(seeds = [ESCROW_SEED, job.key().as_ref()], bump)]
    pub job_escrow: UncheckedAccount<'info>,
    /// CHECK: Provider PDA of job.provider (validated in handler; any key when unclaimed).
    pub provider_account: UncheckedAccount<'info>,
    /// CHECK: validated == job.requester.
    pub requester_wallet: UncheckedAccount<'info>,
    /// CHECK: validated == job.provider, or == job.requester when unclaimed.
    pub provider_wallet: UncheckedAccount<'info>,
    /// CHECK: destination program for the action.
    #[account(address = crate::ID)]
    pub program_id: UncheckedAccount<'info>,
}

pub fn run(ctx: Context<FinishJob>, to: JobStatus, schedule_action: bool) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let signer = ctx.accounts.signer.key();

    // Authorization
    match to {
        JobStatus::Approved | JobStatus::Rejected | JobStatus::Cancelled => {
            require_keys_eq!(signer, ctx.accounts.job.requester, MarketError::Unauthorized);
        }
        JobStatus::Expired => {}
        _ => return err!(MarketError::InvalidTransition),
    }

    // Pass-through account validation for the action
    let job_ro = &ctx.accounts.job;
    require_keys_eq!(ctx.accounts.requester_wallet.key(), job_ro.requester, MarketError::WrongRecipient);
    if job_ro.provider != Pubkey::default() {
        require_keys_eq!(ctx.accounts.provider_wallet.key(), job_ro.provider, MarketError::WrongRecipient);
        let (expected, _) = Pubkey::find_program_address(&[PROVIDER_SEED, job_ro.provider.as_ref()], &crate::ID);
        require_keys_eq!(ctx.accounts.provider_account.key(), expected, MarketError::WrongProviderAccount);
    } else {
        require_keys_eq!(ctx.accounts.provider_wallet.key(), job_ro.requester, MarketError::WrongRecipient);
    }

    // Transition
    {
        let job = &mut ctx.accounts.job;
        check_transition(job.status, to, now, job.deadline_unix)?;
        job.status = to;
    }

    // Scrub private bytes before anything can commit.
    {
        let mut jp = ctx.accounts.job_private.load_mut()?;
        jp.scrub();
    }

    // Close ER-local permissions (skip if never created).
    let requester = ctx.accounts.job.requester;
    let nonce_bytes = ctx.accounts.job.nonce.to_le_bytes();
    let job_bump = [ctx.accounts.job.bump];
    let job_seeds: &[&[u8]] = &[JOB_SEED, requester.as_ref(), &nonce_bytes, &job_bump];
    let job_key = ctx.accounts.job.key();
    let jp_bump = [ctx.bumps.job_private];
    let jp_seeds: &[&[u8]] = &[JOB_PRIVATE_SEED, job_key.as_ref(), &jp_bump];

    if ctx.accounts.job_permission.lamports() > 0 {
        CloseEphemeralPermissionCpi {
            payer: ctx.accounts.job.to_account_info(),
            permissioned_account: ctx.accounts.job.to_account_info(),
            permission: ctx.accounts.job_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.job.to_account_info(),
            authority_is_signer: false,
        }
        .invoke_signed(&[job_seeds])?;
    }
    if ctx.accounts.job_private_permission.lamports() > 0 {
        CloseEphemeralPermissionCpi {
            payer: ctx.accounts.job_private.to_account_info(),
            permissioned_account: ctx.accounts.job_private.to_account_info(),
            permission: ctx.accounts.job_private_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.job_private.to_account_info(),
            authority_is_signer: false,
        }
        .invoke_signed(&[jp_seeds])?;
    }

    // Commit-and-undelegate both PDAs, optionally with the settle action.
    let builder = MagicIntentBundleBuilder::new(
        ctx.accounts.signer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[
        ctx.accounts.job.to_account_info(),
        ctx.accounts.job_private.to_account_info(),
    ]);

    if schedule_action {
        let data = anchor_lang::InstructionData::data(&crate::instruction::SettleAction {});
        let action = CallHandler {
            destination_program: crate::ID,
            accounts: vec![
                ShortAccountMeta { pubkey: ctx.accounts.job_escrow.key().to_bytes().into(), is_writable: true },
                ShortAccountMeta { pubkey: ctx.accounts.job.key().to_bytes().into(), is_writable: false },
                ShortAccountMeta { pubkey: ctx.accounts.provider_account.key().to_bytes().into(), is_writable: true },
                ShortAccountMeta { pubkey: ctx.accounts.requester_wallet.key().to_bytes().into(), is_writable: true },
                ShortAccountMeta { pubkey: ctx.accounts.provider_wallet.key().to_bytes().into(), is_writable: true },
            ],
            args: ActionArgs::new(data),
            escrow_authority: ctx.accounts.signer.to_account_info(),
            compute_units: 200_000,
        };
        builder.add_post_commit_actions([action]).build_and_invoke()?;
    } else {
        builder.build_and_invoke()?;
    }
    Ok(())
}
```

If `.commit_and_undelegate(...)` returns a type that `add_post_commit_actions` is not implemented on in 0.16.2, restructure as two `let` chains (one per branch) each ending in `build_and_invoke()`; do not change the semantics.

- [ ] **Step 2: Write `settle.rs`**

```rust
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::action;

use crate::errors::MarketError;
use crate::logic::{settle_recipient, Recipient};
use crate::state::*;

#[action]
#[derive(Accounts)]
pub struct SettleAction<'info> {
    #[account(mut, seeds = [ESCROW_SEED, job.key().as_ref()], bump = job_escrow.bump)]
    pub job_escrow: Account<'info, Escrow>,
    /// CHECK: deserialized manually; must be owned by this program (undelegated).
    pub job: UncheckedAccount<'info>,
    /// CHECK: validated against job.provider in handler.
    #[account(mut)]
    pub provider_account: UncheckedAccount<'info>,
    /// CHECK: validated == job.requester.
    #[account(mut)]
    pub requester_wallet: UncheckedAccount<'info>,
    /// CHECK: validated == job.provider when paying provider.
    #[account(mut)]
    pub provider_wallet: UncheckedAccount<'info>,
    /// CHECK: payer identity the action was scheduled with.
    pub escrow_auth: UncheckedAccount<'info>,
    /// CHECK: only the delegation program can sign for this PDA; proves the post-commit path.
    #[account(
        signer @ MarketError::Unauthorized,
        address = ephemeral_rollups_sdk::pda::ephemeral_balance_pda_from_payer(&escrow_auth.key(), ACTION_ESCROW_INDEX) @ MarketError::Unauthorized,
    )]
    pub escrow: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SettleDirect<'info> {
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ESCROW_SEED, job.key().as_ref()], bump = job_escrow.bump)]
    pub job_escrow: Account<'info, Escrow>,
    /// CHECK: deserialized manually; must be owned by this program (undelegated).
    pub job: UncheckedAccount<'info>,
    /// CHECK: validated against job.provider in handler.
    #[account(mut)]
    pub provider_account: UncheckedAccount<'info>,
    /// CHECK: validated == job.requester.
    #[account(mut)]
    pub requester_wallet: UncheckedAccount<'info>,
    /// CHECK: validated == job.provider when paying provider.
    #[account(mut)]
    pub provider_wallet: UncheckedAccount<'info>,
}

pub fn settle_action(ctx: Context<SettleAction>) -> Result<()> {
    settle(
        &mut ctx.accounts.job_escrow,
        &ctx.accounts.job.to_account_info(),
        &ctx.accounts.provider_account.to_account_info(),
        &ctx.accounts.requester_wallet.to_account_info(),
        &ctx.accounts.provider_wallet.to_account_info(),
    )
}

pub fn settle_direct(ctx: Context<SettleDirect>) -> Result<()> {
    settle(
        &mut ctx.accounts.job_escrow,
        &ctx.accounts.job.to_account_info(),
        &ctx.accounts.provider_account.to_account_info(),
        &ctx.accounts.requester_wallet.to_account_info(),
        &ctx.accounts.provider_wallet.to_account_info(),
    )
}

fn settle<'info>(
    job_escrow: &mut Account<'info, Escrow>,
    job: &AccountInfo<'info>,
    provider_account: &AccountInfo<'info>,
    requester_wallet: &AccountInfo<'info>,
    provider_wallet: &AccountInfo<'info>,
) -> Result<()> {
    require_keys_eq!(*job.owner, crate::ID, MarketError::JobStillDelegated);
    let job_data = {
        let data = job.try_borrow_data()?;
        Job::try_deserialize(&mut &data[..])?
    };
    require_keys_eq!(job_escrow.job, job.key(), MarketError::EscrowJobMismatch);
    require!(!job_escrow.paid, MarketError::AlreadySettled);
    require!(job_data.status.is_terminal(), MarketError::NotTerminal);
    require_keys_eq!(requester_wallet.key(), job_data.requester, MarketError::WrongRecipient);

    let recipient = match settle_recipient(job_data.status)? {
        Recipient::Provider => {
            require_keys_eq!(provider_wallet.key(), job_data.provider, MarketError::WrongRecipient);
            provider_wallet
        }
        Recipient::Requester => requester_wallet,
    };

    if matches!(job_data.status, JobStatus::Approved | JobStatus::Rejected) {
        let (expected, _) = Pubkey::find_program_address(&[PROVIDER_SEED, job_data.provider.as_ref()], &crate::ID);
        require_keys_eq!(provider_account.key(), expected, MarketError::WrongProviderAccount);
        require_keys_eq!(*provider_account.owner, crate::ID, MarketError::WrongProviderAccount);
        let mut p = {
            let data = provider_account.try_borrow_data()?;
            Provider::try_deserialize(&mut &data[..])?
        };
        match job_data.status {
            JobStatus::Approved => p.completed = p.completed.saturating_add(1),
            JobStatus::Rejected => p.rejected = p.rejected.saturating_add(1),
            _ => {}
        }
        let mut data = provider_account.try_borrow_mut_data()?;
        p.try_serialize(&mut &mut data[..])?;
    }

    let amount = job_escrow.amount;
    **job_escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
    **recipient.try_borrow_mut_lamports()? += amount;
    job_escrow.paid = true;
    Ok(())
}
```

- [ ] **Step 3: Write `close_job.rs`**

```rust
use anchor_lang::prelude::*;

use crate::errors::MarketError;
use crate::state::*;

#[derive(Accounts)]
pub struct CloseJob<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,
    #[account(
        mut,
        close = requester,
        seeds = [JOB_SEED, requester.key().as_ref(), &job.nonce.to_le_bytes()],
        bump = job.bump,
        has_one = requester,
        constraint = job.status.is_terminal() @ MarketError::NotTerminal
    )]
    pub job: Account<'info, Job>,
    #[account(mut, close = requester, seeds = [JOB_PRIVATE_SEED, job.key().as_ref()], bump)]
    pub job_private: AccountLoader<'info, JobPrivate>,
    #[account(
        mut,
        close = requester,
        seeds = [ESCROW_SEED, job.key().as_ref()],
        bump = job_escrow.bump,
        constraint = job_escrow.paid @ MarketError::NotPaid
    )]
    pub job_escrow: Account<'info, Escrow>,
}

pub fn handler(_ctx: Context<CloseJob>) -> Result<()> {
    Ok(())
}
```

- [ ] **Step 4: Wire `mod.rs` and `lib.rs`**

```rust
// mod.rs additions
pub mod close_job;
pub mod finish;
pub mod settle;
pub use close_job::*;
pub use finish::*;
pub use settle::*;
```

```rust
// lib.rs additions
    pub fn approve_job(ctx: Context<FinishJob>, schedule_action: bool) -> Result<()> {
        instructions::finish::run(ctx, state::JobStatus::Approved, schedule_action)
    }
    pub fn reject_job(ctx: Context<FinishJob>, schedule_action: bool) -> Result<()> {
        instructions::finish::run(ctx, state::JobStatus::Rejected, schedule_action)
    }
    pub fn cancel_job(ctx: Context<FinishJob>, schedule_action: bool) -> Result<()> {
        instructions::finish::run(ctx, state::JobStatus::Cancelled, schedule_action)
    }
    pub fn expire_job(ctx: Context<FinishJob>, schedule_action: bool) -> Result<()> {
        instructions::finish::run(ctx, state::JobStatus::Expired, schedule_action)
    }
    pub fn settle_action(ctx: Context<SettleAction>) -> Result<()> {
        instructions::settle::settle_action(ctx)
    }
    pub fn settle_direct(ctx: Context<SettleDirect>) -> Result<()> {
        instructions::settle::settle_direct(ctx)
    }
    pub fn close_job(ctx: Context<CloseJob>) -> Result<()> {
        instructions::close_job::handler(ctx)
    }
```

- [ ] **Step 5: Add local negative tests (append to `tests/inference_market.ts`)**

```ts
test("settle_direct refuses a non-terminal, undelegated job", async () => {
  const nonce = 3n;
  const job = jobPda(wallet.publicKey, nonce);
  await program.methods.createJob(new anchor.BN(3), new anchor.BN(1000), new anchor.BN(Math.floor(Date.now()/1000)+3600), label("x"))
    .accounts({ requester: wallet.publicKey, job, jobPrivate: jobPrivatePda(job), escrow: escrowPda(job), systemProgram: SystemProgram.programId }).rpc();
  await assert.rejects(
    program.methods.settleDirect().accounts({
      payer: wallet.publicKey, jobEscrow: escrowPda(job), job,
      providerAccount: wallet.publicKey, requesterWallet: wallet.publicKey, providerWallet: wallet.publicKey,
    }).rpc(), /NotTerminal/);
});

test("settle_direct refuses a delegated job", async () => {
  const job = jobPda(wallet.publicKey, 1n); // delegated in the earlier test
  await assert.rejects(
    program.methods.settleDirect().accounts({
      payer: wallet.publicKey, jobEscrow: escrowPda(job), job,
      providerAccount: wallet.publicKey, requesterWallet: wallet.publicKey, providerWallet: wallet.publicKey,
    }).rpc(), /JobStillDelegated/);
});

test("close_job refuses an unpaid escrow", async () => {
  const job = jobPda(wallet.publicKey, 3n);
  await assert.rejects(
    program.methods.closeJob().accounts({ requester: wallet.publicKey, job, jobPrivate: jobPrivatePda(job), jobEscrow: escrowPda(job) }).rpc(),
    /NotTerminal|NotPaid/);
});
```

- [ ] **Step 6: Build and run**

```bash
anchor build && cargo test -p inference_market --lib && anchor test
```
Expected: build OK; 9 cargo tests; 7 anchor tests pass. If `#[action]` errors on the explicit `escrow_auth`/`escrow` fields, remove those two fields and the constraint from `SettleAction`, rebuild, and confirm from the macro-expanded output (`cargo expand` or the build error) that it injects them with the escrow signer check; record which variant compiled in `tasks/todo.md`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: terminal instructions with scrub, permission close, commit-and-undelegate, settle action/direct, close_job"
```

---

### Task 7: Devnet deploy

**Files:**
- Modify: `Anchor.toml` (`[provider] cluster = "devnet"` for deploy), `tasks/todo.md`

- [ ] **Step 1: Check TEE status and balance**

```bash
curl -s https://status.magicblock.app/api/services | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const s=JSON.parse(d).environments.devnet.regions.tee.servers["devnet-tee-as.magicblock.app"].live_status;console.log(s);process.exit(s.er?0:1)})'
solana balance --url https://rpc.magicblock.app/devnet
```
Expected: `{ er: true, ... }`; balance ≥ 3 SOL (deploy costs ~1.5 SOL for a program this size; airdrop more if needed).

- [ ] **Step 2: Deploy**

```bash
anchor build
anchor deploy --provider.cluster devnet --provider.wallet ~/.config/solana/id.json
solana program show $(solana address -k target/deploy/inference_market-keypair.json) --url https://rpc.magicblock.app/devnet
```
Expected: `Program Id: <id>` and `Authority: <your wallet>`.

- [ ] **Step 3: Record and commit**

Add the program ID and deploy signature to `tasks/todo.md` under Review notes.

```bash
git add -A && git commit -m "chore: devnet deploy of inference_market"
```

---

### Task 8: TypeScript client library

**Files:**
- Create: `client/package.json`, `client/tsconfig.json`, `client/src/index.ts`, `constants.ts`, `pda.ts`, `connections.ts`, `program.ts`, `hash.ts`, `chunks.ts`, `flows.ts`, `status.ts`
- Test: `client/src/__tests__/pure.test.ts`

**Interfaces:**
- Produces (all exported from `client/src/index.ts`):
  - `constants.ts`: `PROGRAM_ID: PublicKey` (from IDL), `PROMPT_MAX`, `OUTPUT_MAX`, `CHUNK_MAX`, `BASE_URL`, `ROUTER_URL`, `TEE_URL`, `STATUS_URL`.
  - `pda.ts`: `providerPda(wallet)`, `jobPda(requester, nonce: bigint)`, `jobPrivatePda(job)`, `escrowPda(job)`, `permissionPda(account)` (wraps SDK `permissionPdaFromAccount`), `delegationAccounts(acct)` → `{ buffer, record, metadata }`.
  - `connections.ts`: `baseConnection()`, `routerConnection()`, `teeIdentity(teeUrl)`, `authedTeeConnection(teeUrl, pubkey, signMessage)` → `{ connection, token, expiresAt }`, `waitForDelegation(router, accounts: PublicKey[], timeoutMs)` → `fqdn`, `waitForUndelegation(base, account, timeoutMs)`.
  - `program.ts`: `loadProgram(provider: AnchorProvider)`.
  - `hash.ts`: `sha256(bytes: Uint8Array): Uint8Array`.
  - `chunks.ts`: `chunk(bytes: Uint8Array, size = CHUNK_MAX)` → `{ offset, data }[]`.
  - `status.ts`: `assertTeeLive()`.
  - `flows.ts`: `createJob`, `publishJob` (delegate both + wait + init_permissions + write chunks + finalize), `claimJob`, `readPrompt`, `submitOutput`, `readOutput`, `finishJob(kind)`, `settleDirect`, `closeJob`, `topUpActionEscrow`, `listOpenJobs`.

- [ ] **Step 1: Package files**

```json
// client/package.json
{
  "name": "@inference-market/client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "test": "tsx --test src/__tests__/*.test.ts" },
  "dependencies": {
    "@coral-xyz/anchor": "0.32.1",
    "@magicblock-labs/ephemeral-rollups-sdk": "0.15.5",
    "@solana/web3.js": "^1.98.0",
    "@noble/hashes": "^1.5.0",
    "bs58": "^6.0.0"
  }
}
```
`client/tsconfig.json`: copy root `tsconfig.json`, set `"include": ["src/**/*.ts"]`.

- [ ] **Step 2: Failing pure tests**

```ts
// client/src/__tests__/pure.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chunk } from "../chunks";
import { sha256 } from "../hash";
import { jobPda, jobPrivatePda, escrowPda } from "../pda";
import { PublicKey } from "@solana/web3.js";

test("chunk splits at CHUNK_MAX with offsets", () => {
  const bytes = new Uint8Array(2000).fill(7);
  const parts = chunk(bytes, 900);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map(p => p.offset), [0, 900, 1800]);
  assert.equal(parts[2].data.length, 200);
});

test("sha256 matches known vector", () => {
  const h = sha256(new TextEncoder().encode("abc"));
  assert.equal(Buffer.from(h.slice(0, 4)).toString("hex"), "ba7816bf");
});

test("pdas derive deterministically", () => {
  const r = new PublicKey("11111111111111111111111111111112");
  const job = jobPda(r, 1n);
  assert.ok(jobPrivatePda(job).equals(jobPrivatePda(job)));
  assert.ok(!escrowPda(job).equals(jobPrivatePda(job)));
});
```

Run `npm --workspace client test`. Expected: module-not-found failures.

- [ ] **Step 3: Implement `constants.ts`, `hash.ts`, `chunks.ts`, `pda.ts`**

```ts
// constants.ts
import { PublicKey } from "@solana/web3.js";
import idl from "../../target/idl/inference_market.json" with { type: "json" };
export const IDL = idl as any;
export const PROGRAM_ID = new PublicKey((idl as any).address);
export const PROMPT_MAX = 4096;
export const OUTPUT_MAX = 5120;
export const CHUNK_MAX = 900;
export const BASE_URL = process.env.BASE_URL ?? "https://rpc.magicblock.app/devnet";
export const ROUTER_URL = process.env.ROUTER_URL ?? "https://devnet-router.magicblock.app/";
export const TEE_URL = process.env.TEE_URL ?? "https://devnet-tee-as.magicblock.app";
export const STATUS_URL = "https://status.magicblock.app/api/services";
export const ACTION_ESCROW_INDEX = 255;
```

```ts
// hash.ts
import { sha256 as nobleSha256 } from "@noble/hashes/sha256";
export const sha256 = (bytes: Uint8Array): Uint8Array => nobleSha256(bytes);
```

```ts
// chunks.ts
import { CHUNK_MAX } from "./constants";
export function chunk(bytes: Uint8Array, size = CHUNK_MAX): { offset: number; data: Uint8Array }[] {
  const out: { offset: number; data: Uint8Array }[] = [];
  for (let off = 0; off < bytes.length; off += size) out.push({ offset: off, data: bytes.subarray(off, off + size) });
  return out;
}
```

```ts
// pda.ts
import { PublicKey } from "@solana/web3.js";
import {
  permissionPdaFromAccount,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { PROGRAM_ID } from "./constants";

const u64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
export const providerPda = (w: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("provider"), w.toBuffer()], PROGRAM_ID)[0];
export const jobPda = (r: PublicKey, nonce: bigint) => PublicKey.findProgramAddressSync([Buffer.from("job"), r.toBuffer(), u64le(nonce)], PROGRAM_ID)[0];
export const jobPrivatePda = (job: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("job-private"), job.toBuffer()], PROGRAM_ID)[0];
export const escrowPda = (job: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("escrow"), job.toBuffer()], PROGRAM_ID)[0];
export const permissionPda = (acct: PublicKey) => permissionPdaFromAccount(acct);
export const delegationAccounts = (acct: PublicKey) => ({
  buffer: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(acct, PROGRAM_ID),
  record: delegationRecordPdaFromDelegatedAccount(acct),
  metadata: delegationMetadataPdaFromDelegatedAccount(acct),
});
```

Run `npm --workspace client test`. Expected: 3 passing.

- [ ] **Step 4: Implement `connections.ts`, `status.ts`, `program.ts`**

```ts
// connections.ts
import { Connection, PublicKey } from "@solana/web3.js";
import { ConnectionMagicRouter, getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import { BASE_URL, ROUTER_URL, PROGRAM_ID } from "./constants";

export const baseConnection = () => new Connection(BASE_URL, "confirmed");
export const routerConnection = () => new ConnectionMagicRouter(ROUTER_URL, "confirmed");

export async function teeIdentity(teeUrl: string): Promise<PublicKey> {
  const res = await fetch(teeUrl, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getIdentity", params: [] }) });
  return new PublicKey((await res.json()).result.identity);
}

export async function authedTeeConnection(
  teeUrl: string, pubkey: PublicKey, signMessage: (m: Uint8Array) => Promise<Uint8Array>,
) {
  const { token, expiresAt } = await getAuthToken(teeUrl, pubkey, signMessage);
  const http = `${teeUrl}?token=${token}`;
  const ws = `${teeUrl.replace(/^http/, "ws")}?token=${token}`;
  return { connection: new Connection(http, { wsEndpoint: ws, commitment: "confirmed" }), token, expiresAt };
}

export async function waitForDelegation(router: ConnectionMagicRouter, accounts: PublicKey[], timeoutMs = 60_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const statuses = await Promise.all(accounts.map(a => router.getDelegationStatus(a) as Promise<any>));
    const fqdns = statuses.map(s => (s?.isDelegated ? s.fqdn : undefined));
    if (fqdns.every(f => typeof f === "string") && new Set(fqdns).size === 1) return fqdns[0] as string;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`delegation not observed on a single ER within ${timeoutMs}ms`);
}

export async function waitForUndelegation(base: Connection, account: PublicKey, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await base.getAccountInfo(account, "confirmed");
    if (info && info.owner.equals(PROGRAM_ID)) return;
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error(`undelegation of ${account.toBase58()} not observed within ${timeoutMs}ms`);
}
```

```ts
// status.ts
import { STATUS_URL } from "./constants";
export async function assertTeeLive(): Promise<void> {
  const j: any = await (await fetch(STATUS_URL)).json();
  const s = j.environments?.devnet?.regions?.tee?.servers?.["devnet-tee-as.magicblock.app"]?.live_status;
  if (!s || s.er !== true) throw new Error(`TEE devnet ER not operational: ${JSON.stringify(s)}`);
}
```

```ts
// program.ts
import * as anchor from "@coral-xyz/anchor";
import { IDL } from "./constants";
export const loadProgram = (provider: anchor.AnchorProvider) => new anchor.Program(IDL, provider);
```

- [ ] **Step 5: Implement `flows.ts`**

```ts
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, Transaction, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  DELEGATION_PROGRAM_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID, EPHEMERAL_VAULT_ID,
  createTopUpEscrowInstruction, escrowPdaFromEscrowAuthority, GetCommitmentSignature,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { chunk } from "./chunks";
import { ACTION_ESCROW_INDEX, PROGRAM_ID } from "./constants";
import { delegationAccounts, escrowPda, jobPda, jobPrivatePda, permissionPda, providerPda } from "./pda";
import { waitForDelegation } from "./connections";

export type Programs = { base: anchor.Program; er: anchor.Program };
export const label32 = (s: string) => { const b = Buffer.alloc(32); b.write(s.slice(0, 32)); return [...b]; };

export async function registerProvider(base: anchor.Program, authority: PublicKey, model: string) {
  return base.methods.registerProvider(label32(model))
    .accounts({ authority, providerAccount: providerPda(authority), systemProgram: SystemProgram.programId }).rpc();
}

export async function createJob(base: anchor.Program, requester: PublicKey, nonce: bigint, priceLamports: number, deadlineUnix: number, model: string) {
  const job = jobPda(requester, nonce);
  const sig = await base.methods.createJob(new anchor.BN(nonce.toString()), new anchor.BN(priceLamports), new anchor.BN(deadlineUnix), label32(model))
    .accounts({ requester, job, jobPrivate: jobPrivatePda(job), escrow: escrowPda(job), systemProgram: SystemProgram.programId }).rpc();
  return { job, sig };
}

export async function delegateJob(base: anchor.Program, requester: PublicKey, nonce: bigint, validator: PublicKey) {
  const job = jobPda(requester, nonce);
  const jp = jobPrivatePda(job);
  const dj = delegationAccounts(job), dp = delegationAccounts(jp);
  const common = { ownerProgram: PROGRAM_ID, delegationProgram: DELEGATION_PROGRAM_ID, systemProgram: SystemProgram.programId };
  const tx = new Transaction()
    .add(await base.methods.delegateJob(new anchor.BN(nonce.toString())).accounts({
      requester, job, validator, bufferJob: dj.buffer, delegationRecordJob: dj.record, delegationMetadataJob: dj.metadata, ...common }).instruction())
    .add(await base.methods.delegateJobPrivate(new anchor.BN(nonce.toString())).accounts({
      requester, job, jobPrivate: jp, validator, bufferJobPrivate: dp.buffer, delegationRecordJobPrivate: dp.record, delegationMetadataJobPrivate: dp.metadata, ...common }).instruction());
  return (base.provider as anchor.AnchorProvider).sendAndConfirm(tx);
}

const permAccounts = (job: PublicKey) => ({
  jobPermission: permissionPda(job), jobPrivatePermission: permissionPda(jobPrivatePda(job)),
  permissionProgram: PERMISSION_PROGRAM_ID, ephemeralVault: EPHEMERAL_VAULT_ID, magicProgram: MAGIC_PROGRAM_ID,
});

export async function publishJob(p: Programs, router: any, requester: PublicKey, nonce: bigint, validator: PublicKey, prompt: Uint8Array) {
  const job = jobPda(requester, nonce);
  const jp = jobPrivatePda(job);
  await delegateJob(p.base, requester, nonce, validator);
  const fqdn = await waitForDelegation(router, [job, jp]);
  await p.er.methods.initPermissions().accounts({ requester, job, jobPrivate: jp, ...permAccounts(job) }).rpc({ skipPreflight: true });
  for (const c of chunk(prompt)) {
    await p.er.methods.writePrompt(c.offset, Buffer.from(c.data)).accounts({ requester, job, jobPrivate: jp }).rpc({ skipPreflight: true });
  }
  await p.er.methods.finalizePrompt(prompt.length).accounts({ requester, job, jobPrivate: jp }).rpc({ skipPreflight: true });
  return { job, fqdn };
}

export async function claimJob(er: anchor.Program, provider: PublicKey, job: PublicKey) {
  return er.methods.claimJob().accounts({
    provider, providerAccount: providerPda(provider), job, jobPrivate: jobPrivatePda(job),
    jobPrivatePermission: permissionPda(jobPrivatePda(job)), permissionProgram: PERMISSION_PROGRAM_ID,
    ephemeralVault: EPHEMERAL_VAULT_ID, magicProgram: MAGIC_PROGRAM_ID }).rpc({ skipPreflight: true });
}

export async function readPrivate(er: anchor.Program, job: PublicKey) {
  const jp: any = await er.account.jobPrivate.fetch(jobPrivatePda(job));
  const prompt = new Uint8Array(jp.prompt).subarray(0, jp.promptLen);
  const output = new Uint8Array(jp.output).subarray(0, jp.outputLen);
  return { prompt, output };
}

export async function submitOutput(er: anchor.Program, provider: PublicKey, job: PublicKey, output: Uint8Array) {
  const jp = jobPrivatePda(job);
  for (const c of chunk(output)) {
    await er.methods.writeOutput(c.offset, Buffer.from(c.data)).accounts({ provider, job, jobPrivate: jp }).rpc({ skipPreflight: true });
  }
  return er.methods.finalizeOutput(output.length).accounts({ provider, job, jobPrivate: jp }).rpc({ skipPreflight: true });
}

export type FinishKind = "approve" | "reject" | "cancel" | "expire";

export async function topUpActionEscrow(base: Connection, payer: Keypair, lamports = 0.01 * LAMPORTS_PER_SOL) {
  const escrow = escrowPdaFromEscrowAuthority(payer.publicKey, ACTION_ESCROW_INDEX);
  const ix = createTopUpEscrowInstruction(escrow, payer.publicKey, payer.publicKey, lamports, ACTION_ESCROW_INDEX);
  const tx = new Transaction().add(ix);
  const sig = await base.sendTransaction(tx, [payer]);
  await base.confirmTransaction(sig, "confirmed");
  return sig;
}

export async function finishJob(er: anchor.Program, signer: PublicKey, job: PublicKey, kind: FinishKind, scheduleAction: boolean) {
  const j: any = await er.account.job.fetch(job);
  const claimed = !j.provider.equals(PublicKey.default);
  const accounts = {
    signer, job, jobPrivate: jobPrivatePda(job), ...permAccounts(job),
    jobEscrow: escrowPda(job),
    providerAccount: claimed ? providerPda(j.provider) : j.requester,
    requesterWallet: j.requester,
    providerWallet: claimed ? j.provider : j.requester,
    programId: PROGRAM_ID,
  };
  const m = { approve: er.methods.approveJob, reject: er.methods.rejectJob, cancel: er.methods.cancelJob, expire: er.methods.expireJob }[kind];
  const sig = await m(scheduleAction).accounts(accounts).rpc({ skipPreflight: true });
  const commitSig = await GetCommitmentSignature(sig, er.provider.connection);
  return { erSig: sig, commitSig };
}

export async function settleDirect(base: anchor.Program, payer: PublicKey, job: PublicKey) {
  const j: any = await base.account.job.fetch(job);
  const claimed = !j.provider.equals(PublicKey.default);
  return base.methods.settleDirect().accounts({
    payer, jobEscrow: escrowPda(job), job,
    providerAccount: claimed ? providerPda(j.provider) : j.requester,
    requesterWallet: j.requester, providerWallet: claimed ? j.provider : j.requester }).rpc();
}

export async function closeJob(base: anchor.Program, requester: PublicKey, job: PublicKey) {
  return base.methods.closeJob().accounts({ requester, job, jobPrivate: jobPrivatePda(job), jobEscrow: escrowPda(job) }).rpc();
}

export async function listOpenJobs(er: anchor.Program): Promise<{ pubkey: PublicKey; account: any }[]> {
  const all = await er.account.job.all();
  return all.filter((x: any) => "open" in x.account.status);
}
```

`skipPreflight: true` on ER calls: the TEE endpoint requires the auth token on simulation as well as send, and Anchor's simulate path does not forward custom query strings consistently in 0.32.1. Inspect the transaction logs on failure via `er.provider.connection.getTransaction(sig, { commitment: "confirmed" })`.

- [ ] **Step 6: `index.ts` re-exports, typecheck, commit**

```ts
export * from "./constants"; export * from "./pda"; export * from "./connections"; export * from "./program";
export * from "./hash"; export * from "./chunks"; export * from "./flows"; export * from "./status";
```

```bash
npm install && npx tsc -p client --noEmit && npm --workspace client test
git add -A && git commit -m "feat: shared TypeScript client library"
```

---

### Task 9: Devnet TEE end-to-end test

**Files:**
- Create: `tests/devnet/e2e.ts`

**Interfaces:**
- Consumes everything from `@inference-market/client`.

- [ ] **Step 1: Write the test script**

```ts
import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import fs from "node:fs";
import assert from "node:assert/strict";
import {
  assertTeeLive, baseConnection, routerConnection, teeIdentity, authedTeeConnection, loadProgram,
  registerProvider, createJob, publishJob, claimJob, readPrivate, submitOutput, finishJob, settleDirect, closeJob,
  topUpActionEscrow, waitForUndelegation, escrowPda, providerPda, jobPrivatePda, sha256, TEE_URL,
} from "@inference-market/client";

const requester = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"))));
const providerKp = Keypair.generate();
const outsider = Keypair.generate();

const signer = (kp: Keypair) => (m: Uint8Array) => Promise.resolve(nacl.sign.detached(m, kp.secretKey));
const mkProvider = (conn: any, kp: Keypair) => new anchor.AnchorProvider(conn, new anchor.Wallet(kp), { commitment: "confirmed" });

async function main() {
  await assertTeeLive();
  const base = baseConnection();
  const router = routerConnection();
  const validator = await teeIdentity(TEE_URL);
  console.log("TEE validator", validator.toBase58());

  // fund provider + outsider from requester
  const fund = new Transaction()
    .add(SystemProgram.transfer({ fromPubkey: requester.publicKey, toPubkey: providerKp.publicKey, lamports: 0.2 * LAMPORTS_PER_SOL }))
    .add(SystemProgram.transfer({ fromPubkey: requester.publicKey, toPubkey: outsider.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL }));
  await base.confirmTransaction(await base.sendTransaction(fund, [requester]), "confirmed");

  const baseReq = loadProgram(mkProvider(base, requester));
  const baseProv = loadProgram(mkProvider(base, providerKp));
  const teeReq = loadProgram(mkProvider((await authedTeeConnection(TEE_URL, requester.publicKey, signer(requester))).connection, requester));
  const teeProv = loadProgram(mkProvider((await authedTeeConnection(TEE_URL, providerKp.publicKey, signer(providerKp))).connection, providerKp));
  const teeOut = loadProgram(mkProvider((await authedTeeConnection(TEE_URL, outsider.publicKey, signer(outsider))).connection, outsider));

  await registerProvider(baseProv, providerKp.publicKey, "llama3.2:1b");
  await topUpActionEscrow(base, requester);

  // ---- Happy path: approve with Magic Action
  const nonce = BigInt(Date.now());
  const price = 0.01 * LAMPORTS_PER_SOL;
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const { job } = await createJob(baseReq, requester.publicKey, nonce, price, deadline, "llama3.2:1b");
  const prompt = new TextEncoder().encode("Translate to French: the cat sleeps. ".repeat(40)); // > 1 chunk
  const { fqdn } = await publishJob({ base: baseReq, er: teeReq }, router, requester.publicKey, nonce, validator, prompt);
  console.log("delegated to", fqdn);

  // Non-member cannot read private record
  await assert.rejects(readPrivate(teeOut, job), /./, "outsider read must fail");
  // Provider cannot read before claim
  await assert.rejects(readPrivate(teeProv, job), /./, "provider read before claim must fail");

  await claimJob(teeProv, providerKp.publicKey, job);
  const seen = await readPrivate(teeProv, job);
  assert.equal(Buffer.from(seen.prompt).toString(), Buffer.from(prompt).toString());

  const output = new TextEncoder().encode("Le chat dort. ".repeat(80)); // > 1 chunk
  await submitOutput(teeProv, providerKp.publicKey, job, output);
  const jobOnEr: any = await teeReq.account.job.fetch(job);
  assert.deepEqual(new Uint8Array(jobOnEr.outputHash), sha256(output));
  const got = await readPrivate(teeReq, job);
  assert.equal(Buffer.from(got.output).toString(), Buffer.from(output).toString());

  const providerBefore = await base.getBalance(providerKp.publicKey);
  const { commitSig } = await finishJob(teeReq, requester.publicKey, job, "approve", true);
  await base.confirmTransaction(commitSig, "confirmed");
  await waitForUndelegation(base, job);

  // scrubbed on base
  const jpBase: any = await baseReq.account.jobPrivate.fetch(jobPrivatePda(job));
  assert.equal(jpBase.promptLen, 0); assert.equal(jpBase.outputLen, 0);
  assert.ok(new Uint8Array(jpBase.prompt).every((b: number) => b === 0));

  // action delivered, or fall back
  let escrow: any = await baseReq.account.escrow.fetch(escrowPda(job));
  if (!escrow.paid) { console.log("action not observed; settling directly"); await settleDirect(baseProv, providerKp.publicKey, job); escrow = await baseReq.account.escrow.fetch(escrowPda(job)); }
  assert.equal(escrow.paid, true);
  assert.ok((await base.getBalance(providerKp.publicKey)) >= providerBefore + price - 10_000);
  const prov: any = await baseReq.account.provider.fetch(providerPda(providerKp.publicKey));
  assert.equal(prov.completed, 1);
  await assert.rejects(settleDirect(baseProv, providerKp.publicKey, job), /AlreadySettled/);
  await closeJob(baseReq, requester.publicKey, job);

  // ---- Reject path, no action (forces settle_direct)
  const nonce2 = nonce + 1n;
  const { job: job2 } = await createJob(baseReq, requester.publicKey, nonce2, price, deadline, "llama3.2:1b");
  await publishJob({ base: baseReq, er: teeReq }, router, requester.publicKey, nonce2, validator, prompt);
  await claimJob(teeProv, providerKp.publicKey, job2);
  await submitOutput(teeProv, providerKp.publicKey, job2, output);
  const reqBefore = await base.getBalance(requester.publicKey);
  const r2 = await finishJob(teeReq, requester.publicKey, job2, "reject", false);
  await base.confirmTransaction(r2.commitSig, "confirmed");
  await waitForUndelegation(base, job2);
  await settleDirect(baseProv, providerKp.publicKey, job2);
  const e2: any = await baseReq.account.escrow.fetch(escrowPda(job2));
  assert.equal(e2.paid, true);
  const prov2: any = await baseReq.account.provider.fetch(providerPda(providerKp.publicKey));
  assert.equal(prov2.rejected, 1);
  assert.ok((await base.getBalance(requester.publicKey)) > reqBefore);

  console.log("E2E OK", { job: job.toBase58(), job2: job2.toBase58() });
}

main().catch(e => { console.error(e); process.exit(1); });
```
- [ ] **Step 2: Run**

```bash
npm run test:devnet
```
Expected: `E2E OK` with two job addresses. Record both addresses and the ER FQDN in `tasks/todo.md`.

Failure triage (in order): status API → router `getDelegationStatus` for both PDAs → `getAccountInfo` owner on base vs. TEE → ER transaction logs via `getTransaction`. Do not change program logic until versions, program IDs, and validator identity have been confirmed.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test: devnet TEE end-to-end (approve with action, reject with direct settle, privacy gating)"
```

---

### Task 10: Provider worker

**Files:**
- Create: `worker/package.json`, `worker/tsconfig.json`, `worker/.env.example`, `worker/src/index.ts`, `config.ts`, `inference.ts`, `discover.ts`, `reconcile.ts`, `log.ts`
- Test: `worker/src/__tests__/inference.test.ts`

**Interfaces:**
- Consumes `@inference-market/client`.
- Produces a CLI: `npm --workspace worker start`.

- [ ] **Step 1: Package and config**

```json
{
  "name": "@inference-market/worker",
  "private": true,
  "type": "module",
  "scripts": { "start": "tsx src/index.ts", "test": "tsx --test src/__tests__/*.test.ts" },
  "dependencies": { "@inference-market/client": "*", "@coral-xyz/anchor": "0.32.1", "@solana/web3.js": "^1.98.0", "tweetnacl": "^1.0.3", "dotenv": "^16.4.0" }
}
```

```
# worker/.env.example
KEYPAIR_PATH=/home/<user>/.config/solana/provider.json
MODEL_LABEL=llama3.2:1b
INFERENCE_URL=http://localhost:11434/v1/chat/completions
INFERENCE_MODEL=llama3.2:1b
INFERENCE_API_KEY=
POLL_MS=5000
RECONCILE_MS=30000
MIN_TIME_LEFT_S=30
```

```ts
// config.ts
import "dotenv/config";
import fs from "node:fs";
import { Keypair } from "@solana/web3.js";
const req = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
export const cfg = {
  keypair: Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(req("KEYPAIR_PATH"), "utf8")))),
  modelLabel: req("MODEL_LABEL"),
  inferenceUrl: req("INFERENCE_URL"),
  inferenceModel: req("INFERENCE_MODEL"),
  inferenceApiKey: process.env.INFERENCE_API_KEY ?? "",
  pollMs: Number(process.env.POLL_MS ?? 5000),
  reconcileMs: Number(process.env.RECONCILE_MS ?? 30000),
  minTimeLeftS: Number(process.env.MIN_TIME_LEFT_S ?? 30),
};
```

```ts
// log.ts — never log bodies
export const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));
```

- [ ] **Step 2: Failing test for inference adapter**

```ts
// worker/src/__tests__/inference.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInference, truncateOutput } from "../inference";

test("truncateOutput caps at OUTPUT_MAX with marker", () => {
  const big = new Uint8Array(6000).fill(65);
  const out = truncateOutput(big);
  assert.equal(out.length, 5120);
  assert.equal(Buffer.from(out.subarray(5120 - 13)).toString(), "[…truncated]");
});

test("runInference posts OpenAI-compatible body and returns bytes", async () => {
  const fakeFetch: typeof fetch = async (_u, init) => {
    const body = JSON.parse(String(init!.body));
    assert.equal(body.messages[0].role, "user");
    return new Response(JSON.stringify({ choices: [{ message: { content: "bonjour" } }] }), { status: 200 });
  };
  const bytes = await runInference("hi", { url: "http://x", model: "m", apiKey: "" }, fakeFetch);
  assert.equal(Buffer.from(bytes).toString(), "bonjour");
});
```

Run `npm --workspace worker test`. Expected: module-not-found.

- [ ] **Step 3: Implement `inference.ts`**

```ts
import { OUTPUT_MAX } from "@inference-market/client";
const MARKER = new TextEncoder().encode("[…truncated]");

export function truncateOutput(bytes: Uint8Array): Uint8Array {
  if (bytes.length <= OUTPUT_MAX) return bytes;
  const out = new Uint8Array(OUTPUT_MAX);
  out.set(bytes.subarray(0, OUTPUT_MAX - MARKER.length));
  out.set(MARKER, OUTPUT_MAX - MARKER.length);
  return out;
}

export async function runInference(prompt: string, o: { url: string; model: string; apiKey: string }, f: typeof fetch = fetch): Promise<Uint8Array> {
  const res = await f(o.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {}) },
    body: JSON.stringify({ model: o.model, messages: [{ role: "user", content: prompt }], stream: false }),
  });
  if (!res.ok) throw new Error(`inference backend ${res.status}`);
  const j: any = await res.json();
  const text: string = j.choices?.[0]?.message?.content ?? "";
  return truncateOutput(new TextEncoder().encode(text));
}
```

Run tests. Expected: 2 passing.

- [ ] **Step 4: Implement `discover.ts`, `reconcile.ts`, `index.ts`**

```ts
// discover.ts
import { PublicKey } from "@solana/web3.js";
import { listOpenJobs, label32 } from "@inference-market/client";
export async function findClaimable(er: any, modelLabel: string, minTimeLeftS: number): Promise<PublicKey[]> {
  const want = Buffer.from(label32(modelLabel));
  const now = Math.floor(Date.now() / 1000);
  return (await listOpenJobs(er))
    .filter(j => Buffer.from(j.account.modelLabel).equals(want))
    .filter(j => Number(j.account.deadlineUnix) - now > minTimeLeftS)
    .map(j => j.pubkey);
}
```

```ts
// reconcile.ts
import { PublicKey } from "@solana/web3.js";
import { escrowPda, settleDirect, PROGRAM_ID } from "@inference-market/client";
import { log } from "./log";
export async function reconcile(base: any, baseProgram: any, payer: PublicKey, jobs: Set<string>) {
  for (const key of jobs) {
    const job = new PublicKey(key);
    const info = await base.getAccountInfo(job);
    if (!info) { jobs.delete(key); continue; }              // closed
    if (!info.owner.equals(PROGRAM_ID)) continue;            // still delegated
    const escrow: any = await baseProgram.account.escrow.fetch(escrowPda(job));
    if (escrow.paid) { jobs.delete(key); continue; }
    try { await settleDirect(baseProgram, payer, job); log("settled directly", { job: key }); jobs.delete(key); }
    catch (e: any) { log("settle_direct failed", { job: key, err: String(e.message).slice(0, 120) }); }
  }
}
```

```ts
// index.ts
import * as anchor from "@coral-xyz/anchor";
import nacl from "tweetnacl";
import { baseConnection, authedTeeConnection, loadProgram, registerProvider, claimJob, readPrivate, submitOutput, providerPda, assertTeeLive, TEE_URL } from "@inference-market/client";
import { cfg } from "./config";
import { findClaimable } from "./discover";
import { runInference } from "./inference";
import { reconcile } from "./reconcile";
import { log } from "./log";

async function main() {
  await assertTeeLive();
  const base = baseConnection();
  const baseProgram = loadProgram(new anchor.AnchorProvider(base, new anchor.Wallet(cfg.keypair), { commitment: "confirmed" }));
  const tee = await authedTeeConnection(TEE_URL, cfg.keypair.publicKey, m => Promise.resolve(nacl.sign.detached(m, cfg.keypair.secretKey)));
  const er = loadProgram(new anchor.AnchorProvider(tee.connection, new anchor.Wallet(cfg.keypair), { commitment: "confirmed" }));

  if (!(await base.getAccountInfo(providerPda(cfg.keypair.publicKey)))) {
    await registerProvider(baseProgram, cfg.keypair.publicKey, cfg.modelLabel);
    log("registered provider");
  }
  const mine = new Set<string>();
  setInterval(() => reconcile(base, baseProgram, cfg.keypair.publicKey, mine).catch(e => log("reconcile error", { err: String(e) })), cfg.reconcileMs);

  for (;;) {
    try {
      for (const job of await findClaimable(er, cfg.modelLabel, cfg.minTimeLeftS)) {
        try { await claimJob(er, cfg.keypair.publicKey, job); } catch { continue; } // raced by another provider
        log("claimed", { job: job.toBase58() });
        const { prompt } = await readPrivate(er, job);
        const out = await runInference(new TextDecoder().decode(prompt), { url: cfg.inferenceUrl, model: cfg.inferenceModel, apiKey: cfg.inferenceApiKey });
        await submitOutput(er, cfg.keypair.publicKey, job, out);
        log("submitted", { job: job.toBase58(), bytes: out.length });
        mine.add(job.toBase58());
      }
    } catch (e: any) { log("loop error", { err: String(e.message).slice(0, 200) }); }
    await new Promise(r => setTimeout(r, cfg.pollMs));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Smoke run against devnet**

```bash
solana-keygen new --no-bip39-passphrase -o ~/.config/solana/provider.json
solana transfer $(solana address -k ~/.config/solana/provider.json) 0.3 --allow-unfunded-recipient --url https://rpc.magicblock.app/devnet
cp worker/.env.example worker/.env   # edit KEYPAIR_PATH
npm --workspace worker start
```
In a second shell, post a job with a tiny script that calls `createJob` + `publishJob` from the client (reuse the first half of `tests/devnet/e2e.ts`). Expected worker log lines: `claimed`, `submitted`. Then approve from the requester side and observe `settled directly` only if the action did not land.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: provider worker with discovery, inference adapter, reconciliation"
```

---

### Task 11: Web UI

**Files:**
- Create: `app/package.json`, `app/vite.config.ts`, `app/index.html`, `app/src/main.tsx`, `App.tsx`, `wallet.tsx`, `hooks/useMarket.ts`, `pages/Requester.tsx`, `pages/Provider.tsx`, `components/JobCard.tsx`, `NewJobForm.tsx`, `StatusPill.tsx`, `TeeBadge.tsx`

**Interfaces:**
- Consumes `@inference-market/client` (browser: `signMessage` comes from the wallet adapter, not `tweetnacl`).

Load the `impeccable` skill before styling; keep the UI to one accent color, system font stack, and a two-column layout (job list, job detail).

- [ ] **Step 1: Scaffold**

```bash
npm create vite@latest app -- --template react-ts
cd app && npm i @solana/wallet-adapter-react @solana/wallet-adapter-react-ui @solana/wallet-adapter-wallets @solana/web3.js@^1.98.0 @coral-xyz/anchor@0.32.1 @magicblock-labs/ephemeral-rollups-sdk@0.15.5 @inference-market/client buffer
npm i -D vite-plugin-node-polyfills
```
`vite.config.ts`: add `nodePolyfills({ include: ["buffer", "crypto", "stream"] })` to plugins and `define: { "process.env": {} }`.

- [ ] **Step 2: `wallet.tsx` and `hooks/useMarket.ts`**

```tsx
// wallet.tsx
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { BASE_URL } from "@inference-market/client";
import "@solana/wallet-adapter-react-ui/styles.css";
export const Wallets = ({ children }: { children: React.ReactNode }) => (
  <ConnectionProvider endpoint={BASE_URL}>
    <WalletProvider wallets={[new PhantomWalletAdapter(), new SolflareWalletAdapter()]} autoConnect>
      <WalletModalProvider>{children}</WalletModalProvider>
    </WalletProvider>
  </ConnectionProvider>
);
```

```ts
// hooks/useMarket.ts
import { useEffect, useMemo, useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { authedTeeConnection, loadProgram, routerConnection, teeIdentity, TEE_URL } from "@inference-market/client";

export function useMarket() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [er, setEr] = useState<anchor.Program | null>(null);
  const [validator, setValidator] = useState<anchor.web3.PublicKey | null>(null);
  const base = useMemo(() => wallet.publicKey && wallet.signTransaction
    ? loadProgram(new anchor.AnchorProvider(connection, wallet as any, { commitment: "confirmed" })) : null, [connection, wallet.publicKey]);
  useEffect(() => {
    if (!wallet.publicKey || !wallet.signMessage) return;
    (async () => {
      const { connection: tee } = await authedTeeConnection(TEE_URL, wallet.publicKey!, wallet.signMessage!);
      setEr(loadProgram(new anchor.AnchorProvider(tee, wallet as any, { commitment: "confirmed" })));
      setValidator(await teeIdentity(TEE_URL));
    })();
  }, [wallet.publicKey]);
  return { base, er, router: useMemo(routerConnection, []), validator, wallet };
}
```

- [ ] **Step 3: Pages and components**

`Requester.tsx`: `NewJobForm` (model label, price in SOL, deadline minutes, prompt textarea with byte counter capped at 4096) → on submit: `createJob` on base, then `publishJob` with a 4-step progress stepper (create, delegate, permissions, prompt). Below it, `JobCard` list from `base.account.job.all()` filtered by requester on base plus `er.account.job.all()` for live ones, merged by pubkey (ER copy wins while delegated). Detail panel: `StatusPill`, hashes, output text when `readPrivate` succeeds, Approve / Reject buttons calling `finishJob(..., true)` after `topUpActionEscrow` has been done once (button "Fund action escrow" when the balance PDA is empty), and a "Settle now" button that calls `settleDirect` when base status is terminal and `escrow.paid` is false. "Close job" when paid.

`Provider.tsx`: register form; provider card (completed, rejected); list of jobs where `job.provider === wallet` with `StatusPill` and escrow state.

`StatusPill.tsx` maps `Object.keys(status)[0]` to colors: created/open grey, claimed blue, submitted amber, approved green, rejected/cancelled/expired red; suffix " · settling" when terminal and unpaid, " · settled" when paid.

`TeeBadge.tsx` calls `assertTeeLive()` every 30 s and shows green/red.

- [ ] **Step 4: Run and verify manually**

```bash
npm --workspace app run dev
```
Expected: connect Phantom on devnet, post a job with a prompt of ~1500 chars, see status move Created → Open; run the worker; see Submitted and the output text; approve; see " · settled" and provider counter 1.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: web UI for requesters and providers"
```

---

### Task 12: README and demo script

**Files:**
- Create: `README.md`
- Modify: `tasks/todo.md` (review section)

- [ ] **Step 1: Write `README.md`**

Sections: what it is (3 sentences, including the honest trust-model paragraph from the spec verbatim), architecture diagram (Mermaid: requester, provider worker, base, TEE ER, escrow), prerequisites (Task 0 summary), run (deploy, e2e, worker, app), how privacy works (PER permissions, scrub-before-commit), how settlement works (Magic Action plus `settle_direct`), limits (sizes, SOL only, no arbitration), links to the spec and plan.

- [ ] **Step 2: Demo script (add to README under "Demo")**

1. `npm run test:devnet` passes (show E2E OK).
2. Start worker; open app; post job; watch status; approve; show provider balance change and `completed = 1`.
3. Open the TEE explorer link for `JobPrivate` as an outsider to show the read is refused.

- [ ] **Step 3: Update `tasks/todo.md` review section with: program ID, e2e job addresses, any deviations from the spec, and open risks observed. Commit.**

```bash
git add -A && git commit -m "docs: README with architecture, trust model, and demo script"
```

---

## Self-review against the spec

- Spec coverage: accounts (T1), transitions (T2), base instructions (T3), delegation (T4), permissions/prompt/claim/output (T5), terminal + scrub + action + direct settle + close (T6), deploy (T7), client incl. auth, router wait, chunking, escrow top-up (T8), privacy gating and both settlement paths tested (T9), worker discovery/inference/reconcile (T10), UI screens incl. TEE badge and settling/settled states (T11), README (T12). Non-goals untouched.
- Placeholders: none. The two "if the SDK path differs" notes give the exact discovery command and forbid semantic changes.
- Type consistency: `providerAccount`, `jobEscrow`, `requesterWallet`, `providerWallet`, `programId` names match between `finish.rs`, `settle.rs`, and `flows.ts`; `write_chunk` returns `u16` and both callers assign it to `*_len`; `finishJob(kind, scheduleAction)` signature matches T9 and T11 usage; `label32` is defined in `flows.ts` and imported by `discover.ts`.
