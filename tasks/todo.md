# Private Inference Network — task tracker

Plan: docs/superpowers/plans/2026-09-04-private-inference-network.md
Spec: docs/superpowers/specs/2026-09-04-private-inference-network-design.md

- [x] Task 0 toolchain + repo init
- [x] Task 1 Anchor workspace + state
- [x] Task 2 pure logic + cargo tests
- [x] Task 3 register_provider + create_job
- [x] Task 4 delegate instructions
- [x] Task 5 ER instructions (permissions, prompt, claim, output)
- [x] Task 6 terminal instructions + settle + close_job
- [x] Task 7 devnet deploy
- [x] Task 8 TS client library
- [x] Task 9 devnet e2e test
- [x] Task 10 provider worker
- [x] Task 11 web UI
- [x] Task 12 README + demo script

## Review notes
- Task 7 (2026-09-04): deployed to devnet via https://rpc.magicblock.app/devnet. Program ID HWeUskL1BSdZid4xsbSMBeZ4YH4FsTiYpdXDFZKzyBoe, deploy sig 3V2KAtzTXoBcAKCMKTCYCJbeSA2FYS4NG6uTv88uSHnrm5nPjaeY4yU8LvRXu2mdvgekErdUD5JhRGxXrQNySaRo, slot 493040344, authority 5GD6aDwN9DP12QjMy14X9zaw8Zun4d64cnKKK4anhkjV. Public api.devnet RPC throttled the first attempt ("Max retries exceeded"); use `solana program deploy ... -u https://rpc.magicblock.app/devnet --use-rpc --max-sign-attempts 60` and `solana program close --buffers -u https://api.devnet.solana.com` to reclaim a failed buffer.
- Redeploy (2026-09-04) after finish.rs fix: slot 493052648, sig 2kVUvctUpKCfmqG9H4cfFSW3kjhWjmq5k8vGNiS47pjCy5Syw8tYptgxBSG3tKV5N6GxAriNXt3upbWQLHSbdb72.
- Redeploy (2026-09-04) after SettleAction source_program fix: slot 493058493, sig 5fzquzWhhXs3zudvprnjc4xSwQxFR9yi4nrYWp71aPKUH3gq67RJtL1rRuL6ZLnHaU4ZovCtVWSgcfp5rV3jpEVi.
- Redeploy (2026-09-04) after post-undelegate action fix: slot 493061278, sig 3EqJZ8gwaAy2bLxJTK1p8rrPgFooGku3PkzAPohfG7Mws2kSyd9hee9GaedmED9iboJT3ykfhH7qFgLXsPesX6T3.
- Task 9 (2026-09-04): devnet E2E OK. Magic Action settles inside the commitment tx (3E9rCMJLVk6Zo6ATzVo2LqfKvoW3mjLvoNtcNJYJKfYAhwPchPtErTCBEECRGi2KqMVqEZcMgMZjHoGWP6RVmuSt). Router fqdn https://devnet-tee.magicblock.app/. ~0.126 SOL per run.
- Task 12 (2026-09-04): wrote root `README.md` (trust model, architecture diagram, chat-to-job flow, privacy, settlement, prerequisites, run commands, demo script, limits, links). Sources: design spec, `tasks/todo.md` deploy/e2e history, `task-9-report.md`, `worker/.env.example` + `worker/src/config.ts`, `app/src/router.tsx` + `app/src/lib/chat.ts` + `app/src/hooks/useChat.ts`, `idl-accounts.txt`, `task-1-report.md`/`task-3-report.md`/`progress.md`/plan doc for toolchain. Program ID `HWeUskL1BSdZid4xsbSMBeZ4YH4FsTiYpdXDFZKzyBoe`. Deviations from the original spec now documented in the README: chat-first UI (one message = one job, preamble + trimmed history), the Calm visual design, chunked prompt/output writes (`write_prompt`/`write_output` + finalize), output cap of 5120 bytes (not the spec's original 8192, forced by the 10,240-byte CPI account-size limit), auto-approve after `deadline_unix + 3600s`, the base-only `cancel_job_base` refund path, and the post-**undelegate** (not post-commit) placement of `settle_action`. Open risks: no wallet-driven click-through of the chat UI has been recorded in this task (only the underlying `finishJob`/settle logic was exercised by the Task 9 devnet e2e test and the Task 11 build); the 60s `SETTLE_WAIT_MS` client-side wait for the scheduled Magic Action before falling back to `settle_direct` has not been separately observed from the browser; conversations are stored per browser per wallet (`localStorage` key `im.chat.v1.<wallet pubkey>`, nothing shown with no wallet connected), so they do not follow the user to another device, and that storage still has no eviction policy and could grow unbounded in a long-lived browser profile. Task 11's checkbox in this file was left as found (unchecked) since checking it was outside this task's scope even though `task-11-report.md` records it complete.
- Live worker loop (2026-09-05): `npm run test:live` with a running worker (anthropic, real key). Job DDVNtgYssNidEpsciJnhKrjxZkKznZFDe64SbNAhhBt7 labelled claude-opus-5 at 0.010 SOL: claimed +6.4 s, real answer submitted +19.7 s (690 B), approved, settle_direct, provider +0.0100 SOL, closed. LIVE OK.
- Batched send verified live (2026-09-10): `npm run test:live` after commit 6f7040a. Job FFKteTj86QhHfbVJufv4QnBgjo1PozsMb24Us8zZa7Wo, claude-opus-5 at 0.010 SOL. Packed base tx (create + 2 delegates + top-up) landed; rollup sequence signed in one signAllTransactions call; claimed +2.4s, answered +12.9s (709 B), approved, settled by the scheduled action, provider +0.0100 SOL. LIVE OK.
