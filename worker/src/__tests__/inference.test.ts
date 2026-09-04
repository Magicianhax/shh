import { test } from "node:test";
import assert from "node:assert/strict";
import { runInference, truncateOutput } from "../inference";

test("truncateOutput caps at OUTPUT_MAX with marker", () => {
  const big = new Uint8Array(6000).fill(65);
  const out = truncateOutput(big);
  assert.equal(out.length, 5120);
  // "[…truncated]" is 14 bytes in UTF-8 (the "…" ellipsis is 3 bytes).
  assert.equal(Buffer.from(out.subarray(5120 - 14)).toString(), "[…truncated]");
});

test("runInference (openai) posts chat/completions and returns bytes", async () => {
  let seenUrl = "";
  let seenHeaders: Record<string, string> = {};
  const fakeFetch: typeof fetch = async (u, init) => {
    seenUrl = String(u);
    seenHeaders = Object.fromEntries(
      Object.entries((init!.headers as Record<string, string>) ?? {}),
    );
    const body = JSON.parse(String(init!.body));
    assert.equal(body.model, "gpt-4o-mini");
    assert.equal(body.messages[0].role, "user");
    assert.equal(body.messages[0].content, "hi");
    assert.equal(body.max_tokens, 256);
    assert.equal(body.stream, false);
    return new Response(JSON.stringify({ choices: [{ message: { content: "bonjour" } }] }), {
      status: 200,
    });
  };
  const bytes = await runInference(
    "hi",
    { provider: "openai", apiKey: "sk-test", model: "gpt-4o-mini", maxTokens: 256, baseUrl: "http://x/v1" },
    fakeFetch,
  );
  assert.equal(seenUrl, "http://x/v1/chat/completions");
  assert.equal(seenHeaders["Authorization"], "Bearer sk-test");
  assert.equal(Buffer.from(bytes).toString(), "bonjour");
});

test("runInference (anthropic) posts Messages API and returns bytes", async () => {
  let seenUrl = "";
  let seenHeaders: Record<string, string> = {};
  const fakeFetch: typeof fetch = async (u, init) => {
    seenUrl = String(u);
    seenHeaders = Object.fromEntries(
      Object.entries((init!.headers as Record<string, string>) ?? {}),
    );
    const body = JSON.parse(String(init!.body));
    assert.equal(body.model, "claude-fable-5-1");
    assert.equal(body.max_tokens, 256);
    assert.equal(body.messages[0].role, "user");
    assert.equal(body.messages[0].content, "hi");
    return new Response(
      JSON.stringify({ content: [{ type: "text", text: "bonjour" }] }),
      { status: 200 },
    );
  };
  const bytes = await runInference(
    "hi",
    { provider: "anthropic", apiKey: "sk-ant-test", model: "claude-fable-5-1", maxTokens: 256 },
    fakeFetch,
  );
  assert.equal(seenUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(seenHeaders["x-api-key"], "sk-ant-test");
  assert.equal(seenHeaders["anthropic-version"], "2023-06-01");
  assert.equal(Buffer.from(bytes).toString(), "bonjour");
});

test("runInference throws with status code, not body, on non-2xx", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response("leaked prompt or key contents", { status: 401 });
  await assert.rejects(
    () =>
      runInference(
        "hi",
        { provider: "anthropic", apiKey: "sk-ant-test", model: "claude-fable-5-1", maxTokens: 256 },
        fakeFetch,
      ),
    (err: any) => {
      assert.match(err.message, /401/);
      assert.doesNotMatch(err.message, /leaked/);
      return true;
    },
  );
});
