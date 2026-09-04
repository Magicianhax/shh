#!/usr/bin/env bash
# Local-validator test entrypoint. Run from repo root inside WSL.
set -euo pipefail
anchor build
mkdir -p target/deploy
cp "${CARGO_TARGET_DIR:-target}/deploy/inference_market.so" target/deploy/inference_market.so
anchor test --skip-build --validator legacy
