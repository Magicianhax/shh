import { OUTPUT_MAX } from "@inference-market/client";

const MARKER = new TextEncoder().encode("[…truncated]");
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export type InferenceOptions = {
  provider: "anthropic" | "openai" | "ollama";
  apiKey: string;
  model: string;
  maxTokens: number;
  baseUrl?: string;
};

/**
 * Cap `bytes` at `OUTPUT_MAX`, replacing the tail with a truncation marker.
 *
 * The cut point is moved back over any UTF-8 continuation bytes first, so a
 * multi-byte character is never split in half. A half character would decode as
 * U+FFFD in the chat and, worse, change the hash the program computed from
 * bytes the requester can no longer read as text.
 */
export function truncateOutput(bytes: Uint8Array): Uint8Array {
  if (bytes.length <= OUTPUT_MAX) return bytes;
  let end = OUTPUT_MAX - MARKER.length;
  // 0b10xxxxxx is a continuation byte: the cut would land inside a character.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  const out = new Uint8Array(end + MARKER.length);
  out.set(bytes.subarray(0, end));
  out.set(MARKER, end);
  return out;
}

/**
 * Shared request path for OpenAI-compatible chat-completions backends
 * (OpenAI itself, and Ollama's OpenAI-compatible endpoint). The only
 * difference between the two is whether an Authorization header is sent:
 * Ollama needs no key, so an empty apiKey omits the header entirely.
 */
async function openAiCompatible(
  prompt: string,
  o: InferenceOptions,
  f: typeof fetch,
  defaultBaseUrl: string,
  label: string,
): Promise<string> {
  const base = (o.baseUrl ?? defaultBaseUrl).replace(/\/+$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (o.apiKey) headers.Authorization = `Bearer ${o.apiKey}`;
  const res = await f(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: o.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: o.maxTokens,
      stream: false,
    }),
  });
  // Never surface the response body: it can echo the prompt back.
  if (!res.ok) throw new Error(`inference backend (${label}) ${res.status}`);
  const j: any = await res.json();
  return j.choices?.[0]?.message?.content ?? "";
}

async function runAnthropic(
  prompt: string,
  o: InferenceOptions,
  f: typeof fetch,
): Promise<string> {
  const res = await f(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": o.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: o.model,
      max_tokens: o.maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  // Never surface the response body: it can echo the prompt back.
  if (!res.ok) throw new Error(`inference backend (anthropic) ${res.status}`);
  const j: any = await res.json();
  const blocks: any[] = j.content ?? [];
  return blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Run one inference call against the configured backend and return the
 * (possibly truncated) output bytes. Never logs the prompt, the output, or
 * the API key — callers must not either.
 */
export async function runInference(
  prompt: string,
  o: InferenceOptions,
  f: typeof fetch = fetch,
): Promise<Uint8Array> {
  let text: string;
  if (o.provider === "openai") {
    text = await openAiCompatible(prompt, o, f, "https://api.openai.com/v1", "openai");
  } else if (o.provider === "ollama") {
    text = await openAiCompatible(prompt, o, f, "http://127.0.0.1:11434/v1", "ollama");
  } else {
    text = await runAnthropic(prompt, o, f);
  }
  return truncateOutput(new TextEncoder().encode(text));
}
