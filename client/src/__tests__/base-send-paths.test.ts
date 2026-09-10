import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A grep, as a test.
 *
 * Every base-layer send has to draw its blockhash at `finalized` and preflight
 * at `confirmed`; see the comment above `BASE_PREFLIGHT_COMMITMENT`. The APIs
 * below all draw a confirmed blockhash of their own and simulate against it,
 * which reintroduces "Blockhash not found" on the pooled devnet endpoint.
 *
 * This exists because the bug was fixed twice and came back both times, from a
 * path nobody thought to look at: first `AnchorProvider.sendAll` inside
 * `openJob`, then a bare `wallet.sendTransaction` in the top-up hook. Reviewing
 * the diff does not catch a call site that the diff never touched.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

/** Source roots that talk to the base layer. The worker goes through the client. */
const ROOTS = [
  path.join(repo, "client", "src"),
  path.join(repo, "app", "src"),
];

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /\.rpc\(\)/, why: "Anchor's .rpc() draws a confirmed blockhash" },
  { pattern: /\.sendAndConfirm\(/, why: "AnchorProvider.sendAndConfirm draws a confirmed blockhash" },
  { pattern: /\.sendAll\(/, why: "AnchorProvider.sendAll refetches and overwrites the plan's blockhash" },
  {
    pattern: /wallet\.sendTransaction\(\s*tx\s*,\s*connection\s*\)/,
    why: "an unprepared wallet.sendTransaction draws its own confirmed blockhash",
  },
];

/**
 * The rollup is a single node, so a confirmed hash there is never unknown to
 * the node that receives it. Those sends are exempt, and they are the only
 * ones: they live in `flows.ts` behind `erRpc` and `erSendAll`.
 */
const EXEMPT = new Set(["erRpc", "erSendAll"]);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "idl") out.push(...sources(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

test("no base-layer send bypasses the finalized-blockhash helpers", () => {
  const offences: string[] = [];
  for (const root of ROOTS) {
    for (const file of sources(root)) {
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) return;
        for (const { pattern, why } of FORBIDDEN) {
          if (!pattern.test(line)) continue;
          if ([...EXEMPT].some((fn) => line.includes(fn))) continue;
          offences.push(`${path.relative(repo, file)}:${i + 1}  ${line.trim()}\n    ${why}`);
        }
      });
    }
  }
  assert.deepEqual(
    offences,
    [],
    `base-layer sends must go through prepareBaseTx + sendPreparedBaseTx:\n${offences.join("\n")}`,
  );
});

/**
 * A finalized blockhash was tried and reverted. It is rejected at the same rate
 * as a confirmed one, and it arrives about thirty slots old, leaving 48 seconds
 * of the 60 a hash lives — which a Phantom prompt that takes twenty to thirty
 * seconds to open can outlast. The reasoning lives in a commit message and a
 * comment, neither of which stops someone reintroducing it, so it is pinned
 * here. The rollup paths are exempt: that is a single node, not a pool.
 */
test("base blockhashes are drawn at confirmed, never finalized", () => {
  const flows = fs.readFileSync(path.join(repo, "client", "src", "flows.ts"), "utf8");
  const offences = flows
    .split(/\r?\n/)
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => /getLatestBlockhash\(\s*["']finalized["']\s*\)/.test(line));
  assert.deepEqual(
    offences,
    [],
    `use BASE_BLOCKHASH_COMMITMENT; a finalized hash throws away 12 of its 60 seconds:\n${offences
      .map((o) => `  flows.ts:${o.n}  ${o.line}`)
      .join("\n")}`,
  );
});

test("the rollup sends are still exempt, and still present", () => {
  const flows = fs.readFileSync(path.join(repo, "client", "src", "flows.ts"), "utf8");
  // If these are ever renamed the exemption above goes stale and starts
  // silently excusing nothing, so pin the names.
  for (const fn of EXEMPT) {
    assert.ok(flows.includes(`function ${fn}(`), `expected ${fn} in flows.ts`);
  }
  assert.ok(flows.includes('skipPreflight: true'), "rollup sends skip preflight");
});
