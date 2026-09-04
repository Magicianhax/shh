import "dotenv/config";
import fs from "node:fs";
import { Keypair } from "@solana/web3.js";
import type { InferenceOptions } from "./inference";

const req = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

function buildInferenceOptions(): InferenceOptions {
  const provider = req("INFERENCE_PROVIDER");
  if (provider !== "anthropic" && provider !== "openai" && provider !== "ollama") {
    throw new Error(
      `INFERENCE_PROVIDER must be one of "anthropic", "openai", "ollama", got "${provider}"`,
    );
  }
  const maxTokens = Number(process.env.MAX_OUTPUT_TOKENS ?? 1024);
  if (provider === "anthropic") {
    return {
      provider,
      apiKey: req("ANTHROPIC_API_KEY"),
      model: req("ANTHROPIC_MODEL"),
      maxTokens,
    };
  }
  if (provider === "ollama") {
    return {
      provider,
      apiKey: process.env.OLLAMA_API_KEY ?? "",
      model: process.env.OLLAMA_MODEL ?? "llama3.2:1b",
      maxTokens,
      baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1",
    };
  }
  return {
    provider,
    apiKey: req("OPENAI_API_KEY"),
    model: req("OPENAI_MODEL"),
    maxTokens,
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  };
}

export const cfg = {
  keypair: Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(req("KEYPAIR_PATH"), "utf8")))),
  modelLabel: req("MODEL_LABEL"),
  inference: buildInferenceOptions(),
  pollMs: Number(process.env.POLL_MS ?? 5000),
  reconcileMs: Number(process.env.RECONCILE_MS ?? 30000),
  minTimeLeftS: Number(process.env.MIN_TIME_LEFT_S ?? 30),
};
