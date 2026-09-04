# Ollama provider — worker

## What changed

- `worker/src/inference.ts`: `InferenceOptions.provider` now accepts
  `"anthropic" | "openai" | "ollama"`. Extracted a shared `openAiCompatible()`
  helper (used by both the `openai` and `ollama` branches) that builds the
  chat-completions request and only sets an `Authorization` header when
  `apiKey` is non-empty. `ollama` defaults its base URL to
  `http://127.0.0.1:11434/v1` and posts to `${baseUrl}/chat/completions`,
  reading `choices[0].message.content` exactly like OpenAI. Non-2xx errors
  still surface only the HTTP status, never the response body.
- `worker/src/config.ts`: added the `ollama` branch to `buildInferenceOptions`.
  Requires nothing (no API key); reads `OLLAMA_MODEL` (default
  `llama3.2:1b`) and `OLLAMA_BASE_URL` (default
  `http://127.0.0.1:11434/v1`). Unknown `INFERENCE_PROVIDER` values now throw
  listing all three valid options.
- `worker/.env.example`: documented `INFERENCE_PROVIDER=... | ollama`, added
  `OLLAMA_MODEL` and `OLLAMA_BASE_URL` with a comment that no API key is
  needed.
- `worker/src/__tests__/inference.test.ts`: added a fake-fetch test for
  `ollama` asserting the URL
  (`http://127.0.0.1:11434/v1/chat/completions`), that no `Authorization`
  header is sent, the request body's `model`/prompt placement, and the
  decoded response. All 5 pre-existing tests still pass unchanged.
- `README.md`: worker run section now lists all three backends with their
  env vars, the Ollama install/pull commands, and a note that `MODEL_LABEL`
  must match the job's model label for the worker to claim it.

## Defaults chosen

- `OLLAMA_MODEL` default: `llama3.2:1b` (small, fast to pull, matches the
  README's demo pull command).
- `OLLAMA_BASE_URL` default: `http://127.0.0.1:11434/v1` (Ollama's own
  OpenAI-compatible endpoint default).
- No API key required for `ollama`; `OLLAMA_API_KEY` is optional and only
  adds an `Authorization` header if set (for a proxied/authenticated Ollama
  deployment).

## Test output (tail)

```
✔ truncateOutput caps at OUTPUT_MAX with marker (0.901185ms)
✔ truncateOutput never splits a multi-byte character (0.273689ms)
✔ runInference (openai) posts chat/completions and returns bytes (17.459157ms)
✔ runInference (ollama) posts to the OpenAI-compatible endpoint with no auth header (0.852069ms)
✔ runInference (anthropic) posts Messages API and returns bytes (0.531525ms)
✔ runInference throws with status code, not body, on non-2xx (1.296909ms)
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

`tsc -p worker --noEmit` — clean, no errors.
