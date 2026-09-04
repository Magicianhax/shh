import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { MODEL_LABEL_LEN } from "./constants";

/** Inference backends a provider worker can be pointed at. */
export type Provider = "anthropic" | "openai" | "ollama";

/**
 * Where a model sits in its provider's range. Exactly one model per provider is
 * `default`; everything cheaper is `lower` and everything dearer is `higher`.
 */
export type Tier = "lower" | "default" | "higher";

export interface ModelSpec {
  /**
   * The exact backend model id. This string is what goes into the job's
   * `model_label`, so it must stay within `MODEL_LABEL_LEN` bytes.
   */
  id: string;
  provider: Provider;
  /** Short human label for the picker. */
  name: string;
  tier: Tier;
  /**
   * Suggested price per message in SOL. Devnet figures: illustrative, but
   * ordered so a dearer model is never cheaper than a lesser one.
   */
  priceSol: number;
  note?: string;
}

/**
 * The catalog both halves of the market read from. The requester picks a row
 * and its `id` becomes the job's `model_label`; the worker serves the rows of
 * its own provider and refuses jobs priced under `priceSol`.
 *
 * Ordered lower → default → higher within each provider, which is also the
 * order the picker renders.
 */
export const MODELS: ModelSpec[] = [
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    name: "Claude Haiku 4.5",
    tier: "lower",
    priceSol: 0.002,
  },
  {
    id: "claude-sonnet-5",
    provider: "anthropic",
    name: "Claude Sonnet 5",
    tier: "lower",
    priceSol: 0.004,
  },
  {
    id: "claude-opus-5",
    provider: "anthropic",
    name: "Claude Opus 5",
    tier: "default",
    priceSol: 0.01,
  },
  {
    id: "claude-fable-5-1",
    provider: "anthropic",
    name: "Claude Fable 5.1",
    tier: "higher",
    priceSol: 0.02,
    note: "Fable is the most capable and most expensive",
  },
  {
    id: "gpt-5.6-luna",
    provider: "openai",
    name: "GPT-5.6 Luna",
    tier: "lower",
    priceSol: 0.002,
  },
  {
    id: "gpt-5.6-terra",
    provider: "openai",
    name: "GPT-5.6 Terra",
    tier: "default",
    priceSol: 0.006,
  },
  {
    id: "gpt-5.6-sol",
    provider: "openai",
    name: "GPT-5.6 Sol",
    tier: "higher",
    priceSol: 0.012,
    note: "OpenAI's flagship; gpt-6-astra is gated behind Trusted Access",
  },
  {
    id: "llama3.2:1b",
    provider: "ollama",
    name: "Llama 3.2 1B",
    tier: "lower",
    priceSol: 0.0005,
  },
  {
    id: "llama3.1:8b",
    provider: "ollama",
    name: "Llama 3.1 8B",
    tier: "default",
    priceSol: 0.001,
  },
  {
    id: "llama3.3:70b",
    provider: "ollama",
    name: "Llama 3.3 70B",
    tier: "higher",
    priceSol: 0.003,
  },
];

/** What a fresh conversation asks for: the Anthropic default tier. */
export const DEFAULT_MODEL_ID = "claude-opus-5";

export const PROVIDERS: Provider[] = ["anthropic", "openai", "ollama"];

/** How the picker names each group. */
export const PROVIDER_NAMES: Record<Provider, string> = {
  anthropic: "Claude",
  openai: "GPT",
  ollama: "Ollama",
};

const BY_ID = new Map(MODELS.map((m) => [m.id, m]));

export const modelById = (id: string): ModelSpec | undefined => BY_ID.get(id);

/** Every model of one provider, ordered lower → higher. */
export const modelsFor = (provider: Provider): ModelSpec[] =>
  MODELS.filter((m) => m.provider === provider);

/**
 * The catalog price as lamports. Rounded, because a job's price is an integer
 * and the SOL figures above are not all exactly representable.
 */
export const priceLamports = (spec: ModelSpec): number =>
  Math.round(spec.priceSol * LAMPORTS_PER_SOL);

/** Byte length of a model id, the measure `MODEL_LABEL_LEN` caps. */
export const idBytes = (id: string): number => new TextEncoder().encode(id).length;

/** True when `id` fits the on-chain label without truncation. */
export const fitsLabel = (id: string): boolean => idBytes(id) <= MODEL_LABEL_LEN;
