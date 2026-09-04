import "dotenv/config";
import fs from "node:fs";
import { Keypair } from "@solana/web3.js";
import {
  modelById,
  modelsFor,
  priceLamports,
  type ModelSpec,
  type Provider,
} from "@inference-market/client";
import type { InferenceOptions } from "./inference";

const req = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

/** Everything about one model this worker will claim jobs for. */
export type ServedModel = {
  spec: ModelSpec;
  /**
   * What the backend itself calls this model. Usually the catalog id, but an
   * Ollama tag or a renamed hosted model can differ, hence `MODEL_MAP`.
   */
  backendModel: string;
  /** Jobs priced under this are left for someone else. */
  floorLamports: number;
};

/** Connection settings for the backend, minus the per-job model. */
export type InferenceBase = Omit<InferenceOptions, "model">;

function readProvider(): Provider {
  const provider = req("INFERENCE_PROVIDER");
  if (provider !== "anthropic" && provider !== "openai" && provider !== "ollama") {
    throw new Error(
      `INFERENCE_PROVIDER must be one of "anthropic", "openai", "ollama", got "${provider}"`,
    );
  }
  return provider;
}

function buildInferenceBase(provider: Provider): InferenceBase {
  const maxTokens = Number(process.env.MAX_OUTPUT_TOKENS ?? 1024);
  if (provider === "anthropic") {
    return { provider, apiKey: req("ANTHROPIC_API_KEY"), maxTokens };
  }
  if (provider === "ollama") {
    return {
      provider,
      // Ollama serves locally with no auth, so an empty key is the normal case.
      apiKey: process.env.OLLAMA_API_KEY ?? "",
      maxTokens,
      baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1",
    };
  }
  return {
    provider,
    apiKey: req("OPENAI_API_KEY"),
    maxTokens,
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  };
}

/**
 * `MODEL_MAP` is a JSON object from catalog id to backend model id, for the
 * cases where the two differ: an Ollama tag pinned to a digest, or a hosted
 * model the provider renamed. Anything absent maps to itself.
 */
function readModelMap(): Record<string, string> {
  const raw = process.env.MODEL_MAP;
  if (!raw || !raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("MODEL_MAP must be a JSON object of {catalog id: backend model id}");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("MODEL_MAP must be a JSON object of {catalog id: backend model id}");
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== "string" || !v) throw new Error(`MODEL_MAP["${k}"] must be a non-empty string`);
    if (!modelById(k)) throw new Error(`MODEL_MAP key "${k}" is not a catalog model id`);
    out[k] = v;
  }
  return out;
}

/**
 * The models this worker claims for. `MODELS` (the env var) narrows the
 * provider's catalog rows to a subset; unset means every row of the provider.
 * Every entry must belong to the configured provider, so a misconfigured
 * worker fails at boot rather than claiming a job it cannot answer.
 */
function readServed(provider: Provider): Map<string, ServedModel> {
  const catalog = modelsFor(provider);
  const wanted = (process.env.MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let specs: ModelSpec[];
  if (wanted.length === 0) {
    specs = catalog;
  } else {
    specs = wanted.map((id) => {
      const spec = modelById(id);
      if (!spec) throw new Error(`MODELS entry "${id}" is not a catalog model id`);
      if (spec.provider !== provider) {
        throw new Error(
          `MODELS entry "${id}" belongs to provider "${spec.provider}", not "${provider}"`,
        );
      }
      return spec;
    });
  }
  if (specs.length === 0) throw new Error(`no catalog models for provider "${provider}"`);

  const rawMultiplier = process.env.PRICE_FLOOR_MULTIPLIER;
  const multiplier = rawMultiplier === undefined || rawMultiplier === "" ? 1 : Number(rawMultiplier);
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new Error("PRICE_FLOOR_MULTIPLIER must be a non-negative number");
  }

  const map = readModelMap();
  return new Map(
    specs.map((spec) => [
      spec.id,
      {
        spec,
        backendModel: map[spec.id] ?? spec.id,
        floorLamports: Math.ceil(priceLamports(spec) * multiplier),
      },
    ]),
  );
}

/**
 * The `Provider` account carries one 32-byte label, but a worker now answers
 * for several models. Register under the default-tier model when it is served,
 * else the first served model, so the registry names something this worker
 * really answers for.
 */
function registerLabelFor(served: Map<string, ServedModel>): string {
  for (const s of served.values()) if (s.spec.tier === "default") return s.spec.id;
  const first = served.values().next().value;
  return first!.spec.id;
}

const provider = readProvider();
const served = readServed(provider);

export const cfg = {
  keypair: Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(req("KEYPAIR_PATH"), "utf8")))),
  provider,
  served,
  registerLabel: registerLabelFor(served),
  inference: buildInferenceBase(provider),
  pollMs: Number(process.env.POLL_MS ?? 5000),
  reconcileMs: Number(process.env.RECONCILE_MS ?? 30000),
  minTimeLeftS: Number(process.env.MIN_TIME_LEFT_S ?? 30),
};
