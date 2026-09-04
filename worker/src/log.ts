// Never log request/response bodies, prompts, outputs, or API keys/tokens.
export const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

/**
 * Turn a thrown value into a short, safe string. Mirrors the app's `errText`:
 * TEE errors carry the read auth token in the endpoint's query string, so strip
 * it before anything reaches a log line, then cap the length.
 */
export const redact = (e: unknown, max = 300): string =>
  (e instanceof Error ? e.message : String(e))
    .replace(/token=[^&\s]+/gi, "token=[redacted]")
    .slice(0, max);
