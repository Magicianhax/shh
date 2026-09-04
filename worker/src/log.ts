// Never log request/response bodies, prompts, outputs, or API keys/tokens.
export const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));
