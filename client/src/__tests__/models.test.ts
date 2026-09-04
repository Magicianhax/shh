import { test } from "node:test";
import assert from "node:assert/strict";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { MODEL_LABEL_LEN } from "../constants";
import {
  DEFAULT_MODEL_ID,
  MODELS,
  PROVIDERS,
  fitsLabel,
  idBytes,
  modelById,
  modelsFor,
  priceLamports,
  type Tier,
} from "../models";

test("every model id fits the on-chain label", () => {
  for (const m of MODELS) {
    assert.ok(
      idBytes(m.id) <= MODEL_LABEL_LEN,
      `${m.id} is ${idBytes(m.id)} bytes, over the ${MODEL_LABEL_LEN}-byte label`,
    );
    assert.ok(fitsLabel(m.id));
  }
});

test("model ids are unique", () => {
  assert.equal(new Set(MODELS.map((m) => m.id)).size, MODELS.length);
});

test("exactly one default per provider", () => {
  for (const p of PROVIDERS) {
    const defaults = modelsFor(p).filter((m) => m.tier === "default");
    assert.equal(defaults.length, 1, `${p} must have exactly one default-tier model`);
  }
});

test("every provider has all three tiers represented", () => {
  for (const p of PROVIDERS) {
    const tiers = new Set(modelsFor(p).map((m) => m.tier));
    for (const t of ["lower", "default", "higher"] as Tier[]) {
      assert.ok(tiers.has(t), `${p} is missing a ${t}-tier model`);
    }
  }
});

test("prices strictly increase with tier within a provider", () => {
  const rank: Record<Tier, number> = { lower: 0, default: 1, higher: 2 };
  for (const p of PROVIDERS) {
    const models = modelsFor(p);
    for (const a of models) {
      for (const b of models) {
        if (rank[a.tier] < rank[b.tier]) {
          assert.ok(
            a.priceSol < b.priceSol,
            `${p}: ${a.id} (${a.tier}, ${a.priceSol}) must cost less than ${b.id} (${b.tier}, ${b.priceSol})`,
          );
        }
      }
    }
  }
});

test("modelsFor returns catalog order, lower before higher", () => {
  const rank: Record<Tier, number> = { lower: 0, default: 1, higher: 2 };
  for (const p of PROVIDERS) {
    const tiers = modelsFor(p).map((m) => rank[m.tier]);
    for (let i = 1; i < tiers.length; i += 1) {
      assert.ok(tiers[i] >= tiers[i - 1], `${p} is not ordered lower → higher`);
    }
  }
});

test("DEFAULT_MODEL_ID is the anthropic default", () => {
  const spec = modelById(DEFAULT_MODEL_ID);
  assert.ok(spec, "DEFAULT_MODEL_ID must name a catalog model");
  assert.equal(spec.provider, "anthropic");
  assert.equal(spec.tier, "default");
  assert.equal(spec.id, modelsFor("anthropic").find((m) => m.tier === "default")?.id);
});

test("modelById misses on an unknown id", () => {
  assert.equal(modelById("not-a-model"), undefined);
});

test("priceLamports converts SOL to integer lamports", () => {
  for (const m of MODELS) {
    const lam = priceLamports(m);
    assert.ok(Number.isInteger(lam), `${m.id} must price to whole lamports`);
    assert.ok(lam > 0);
    assert.ok(Math.abs(lam / LAMPORTS_PER_SOL - m.priceSol) < 1e-9);
  }
});
