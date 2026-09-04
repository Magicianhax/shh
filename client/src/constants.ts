import { PublicKey } from "@solana/web3.js";
// Vendored copy of `target/idl/inference_market.json`. `target/` is git-ignored,
// so the IDL is committed here to survive a fresh clone. Re-copy it after every
// `anchor build` that changes the program: `npm run idl:sync` at the repo root.
import idl from "./idl/inference_market.json" with { type: "json" };

export const IDL = idl as any;
export const PROGRAM_ID = new PublicKey((idl as any).address);

/** Byte capacity of `JobPrivate.prompt` (must match `state::PROMPT_MAX`). */
export const PROMPT_MAX = 4096;
/** Byte capacity of `JobPrivate.output` (must match `state::OUTPUT_MAX`). */
export const OUTPUT_MAX = 5120;
/** Maximum bytes per `write_prompt` / `write_output` chunk (`state::CHUNK_MAX`). */
export const CHUNK_MAX = 900;
/** Fixed length of the model label array (`state::MODEL_LABEL_LEN`). */
export const MODEL_LABEL_LEN = 32;

export const BASE_URL = process.env.BASE_URL ?? "https://rpc.magicblock.app/devnet";
export const ROUTER_URL = process.env.ROUTER_URL ?? "https://devnet-router.magicblock.app/";
export const TEE_URL = process.env.TEE_URL ?? "https://devnet-tee-as.magicblock.app";
export const STATUS_URL = "https://status.magicblock.app/api/services";

/** Ephemeral-balance escrow index used for scheduled Magic Actions (`state::ACTION_ESCROW_INDEX`). */
export const ACTION_ESCROW_INDEX = 255;
/**
 * Grace period after `deadline_unix` during which only the requester may approve
 * a `Submitted` job. Once it elapses, `approve_job` becomes permissionless
 * (`state::AUTO_APPROVE_SECS`).
 */
export const AUTO_APPROVE_SECS = 3600;
