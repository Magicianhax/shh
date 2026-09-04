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
- [ ] Task 9 devnet e2e test
- [ ] Task 10 provider worker
- [ ] Task 11 web UI
- [ ] Task 12 README + demo script

## Review notes
- Task 7 (2026-09-04): deployed to devnet via https://rpc.magicblock.app/devnet. Program ID HWeUskL1BSdZid4xsbSMBeZ4YH4FsTiYpdXDFZKzyBoe, deploy sig 3V2KAtzTXoBcAKCMKTCYCJbeSA2FYS4NG6uTv88uSHnrm5nPjaeY4yU8LvRXu2mdvgekErdUD5JhRGxXrQNySaRo, slot 493040344, authority 5GD6aDwN9DP12QjMy14X9zaw8Zun4d64cnKKK4anhkjV. Public api.devnet RPC throttled the first attempt ("Max retries exceeded"); use `solana program deploy ... -u https://rpc.magicblock.app/devnet --use-rpc --max-sign-attempts 60` and `solana program close --buffers -u https://api.devnet.solana.com` to reclaim a failed buffer.
- Redeploy (2026-09-04) after finish.rs fix: slot 493052648, sig 2kVUvctUpKCfmqG9H4cfFSW3kjhWjmq5k8vGNiS47pjCy5Syw8tYptgxBSG3tKV5N6GxAriNXt3upbWQLHSbdb72.
- Redeploy (2026-09-04) after SettleAction source_program fix: slot 493058493, sig 5fzquzWhhXs3zudvprnjc4xSwQxFR9yi4nrYWp71aPKUH3gq67RJtL1rRuL6ZLnHaU4ZovCtVWSgcfp5rV3jpEVi.
