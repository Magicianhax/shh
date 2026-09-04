import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { PublicKey } from "@solana/web3.js";
import {
  MODEL_LABEL_LEN,
  PROMPT_MAX,
  createJob,
  jobPrivatePda,
  permissionPda,
  publishJob,
} from "@inference-market/client";
import { PublishSteps } from "./PublishSteps";
import type { PublishStep, StepState } from "./PublishSteps";
import { StepperPill } from "./StepperPill";
import { LockIcon } from "./icons";
import type { Market } from "../hooks/useMarket";
import { useNotify } from "../notify";
import { byteLen, capBytes, errText, shortKey } from "../lib/format";

const STEP_NAMES = ["Create", "Delegate", "Permissions", "Prompt"] as const;

const MODELS = ["llama-3.1-8b", "mistral-7b-instruct", "qwen2.5-coder-7b", "phi-3-mini"];

/** Price ladder in lamports, and the deadline ladder in minutes. */
const PRICES = [1e6, 2e6, 5e6, 1e7, 2e7, 5e7, 1e8, 2.5e8, 5e8];
const MINUTES = [5, 10, 15, 30, 60, 120, 240, 720, 1440];

const closest = (ladder: number[], v: number) =>
  ladder.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(ladder[best] - v) ? i : best), 0);

type Props = {
  market: Market;
  onPublished: (job: PublicKey) => void;
};

/**
 * The prompt box. Auto-growing textarea, model chips, price and deadline as
 * inline steppers, a byte meter welded to the bottom edge, and one primary
 * action.
 *
 * `publishJob` is a single call, so the progress stepper is driven by what can
 * actually be observed while it runs: the router's delegation status, then the
 * ER-local permission account. The elapsed milliseconds printed per step are
 * measured, not simulated. Nothing here reads or logs the prompt bytes.
 */
export function Composer({ market, onPublished }: Props) {
  const { base, er, router, validator, wallet } = market;
  const notify = useNotify();

  const [model, setModel] = useState(MODELS[0]);
  const [priceIdx, setPriceIdx] = useState(closest(PRICES, 1e7));
  const [minsIdx, setMinsIdx] = useState(closest(MINUTES, 30));
  const [prompt, setPrompt] = useState("");
  const [steps, setSteps] = useState<PublishStep[]>([]);
  const [busy, setBusy] = useState(false);

  const boxRef = useRef<HTMLTextAreaElement>(null);
  const watcher = useRef(0);
  const clock = useRef<number[]>([]);

  const bytes = byteLen(prompt);
  const fill = Math.min(1, bytes / PROMPT_MAX);
  const priceLamports = PRICES[priceIdx];
  const mins = MINUTES[minsIdx];

  const ready = Boolean(base && er && validator && wallet.publicKey);
  const valid = ready && model.trim().length > 0 && bytes > 0;

  // Grow the box with its content, up to the CSS max-height.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [prompt]);

  const setStep = (index: number, state: StepState, ms?: number) =>
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, state, ms: ms ?? s.ms } : s)),
    );

  /** Close out step `index` and open the next one, recording elapsed time. */
  const advance = (index: number) => {
    const now = performance.now();
    const started = clock.current[index] ?? now;
    setStep(index, "done", now - started);
    if (index + 1 < STEP_NAMES.length) {
      clock.current[index + 1] = now;
      setStep(index + 1, "active");
    }
  };

  /** Advance steps 2 and 3 from observable on-chain facts while `publishJob` runs. */
  const watch = (job: PublicKey) => {
    let seenDelegated = false;
    watcher.current = window.setInterval(() => {
      void (async () => {
        try {
          if (!seenDelegated) {
            const status: any = await router.getDelegationStatus(job);
            if (status?.isDelegated) {
              seenDelegated = true;
              advance(1);
            }
            return;
          }
          if (!er) return;
          const perm = await er.provider.connection.getAccountInfo(
            permissionPda(jobPrivatePda(job)),
            "confirmed",
          );
          if (perm) {
            advance(2);
            window.clearInterval(watcher.current);
            watcher.current = 0;
          }
        } catch {
          /* transient RPC hiccups must not fail the publish */
        }
      })();
    }, 900);
  };

  const stopWatch = () => {
    if (watcher.current) window.clearInterval(watcher.current);
    watcher.current = 0;
  };

  useEffect(() => stopWatch, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || !base || !er || !validator || !wallet.publicKey) return;

    setBusy(true);
    const start = performance.now();
    clock.current = [start];
    setSteps(
      STEP_NAMES.map((name, i) => ({ name, state: i === 0 ? "active" : "idle", ms: null })),
    );
    let stage = 0;

    try {
      const nonce = BigInt(Date.now());
      const deadlineUnix = Math.floor(Date.now() / 1000) + mins * 60;

      const { job, sig } = await createJob(
        base,
        wallet.publicKey,
        nonce,
        priceLamports,
        deadlineUnix,
        model.trim(),
      );
      advance(0);
      stage = 1;
      notify("ok", "Job created on devnet", `Signature ${shortKey(sig, 8)}`);

      watch(job);
      const promptBytes = new TextEncoder().encode(prompt);
      await publishJob({ base, er }, router, wallet.publicKey, nonce, validator, promptBytes);
      stopWatch();

      // Close out whatever the watcher did not observe before the call returned.
      const end = performance.now();
      setSteps((prev) =>
        prev.map((s, i) => ({
          ...s,
          state: "done",
          ms: s.ms ?? end - (clock.current[i] ?? start),
        })),
      );
      setPrompt("");
      notify("ok", "Job is open", `Sealed in the rollup in ${((end - start) / 1000).toFixed(1)} s.`);
      onPublished(job);
    } catch (err) {
      stopWatch();
      setStep(stage, "failed");
      notify("err", "Publish failed", errText(err));
    } finally {
      setBusy(false);
    }
  };

  const custom = !MODELS.includes(model);

  return (
    <form className="panel composer" onSubmit={submit}>
      <div className="composer-box">
        <textarea
          ref={boxRef}
          id="prompt"
          aria-label="Prompt"
          value={prompt}
          disabled={busy}
          spellCheck={false}
          onChange={(e) => setPrompt(capBytes(e.target.value, PROMPT_MAX))}
          placeholder="Ask the model something. Nobody outside the enclave and the two wallets on this job can read it."
        />
        <div className={`meter-track${bytes >= PROMPT_MAX ? " full" : ""}`}>
          <i style={{ "--p": fill } as CSSProperties} />
        </div>
        <div className="composer-foot">
          <span className={`composer-count${bytes >= PROMPT_MAX ? " full" : ""}`}>
            {bytes.toLocaleString()} / {PROMPT_MAX.toLocaleString()} bytes
          </span>
          <span className="spacer" />
          <StepperPill
            label="price"
            text={(priceLamports / LAMPORTS_PER_SOL).toFixed(3)}
            unit="SOL"
            canDown={priceIdx > 0}
            canUp={priceIdx < PRICES.length - 1}
            disabled={busy}
            onStep={(d) => setPriceIdx((i) => Math.min(PRICES.length - 1, Math.max(0, i + d)))}
          />
          <StepperPill
            label="deadline"
            text={mins >= 60 ? `${mins / 60}` : `${mins}`}
            unit={mins >= 60 ? "hours" : "min"}
            canDown={minsIdx > 0}
            canUp={minsIdx < MINUTES.length - 1}
            disabled={busy}
            onStep={(d) => setMinsIdx((i) => Math.min(MINUTES.length - 1, Math.max(0, i + d)))}
          />
          <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
            {busy ? <i className="spin" /> : <LockIcon size={14} />}
            {busy ? "Publishing" : "Publish privately"}
          </button>
        </div>
      </div>

      <div className="composer-row">
        <span className="label" style={{ margin: 0, alignSelf: "center" }}>
          Model
        </span>
        {MODELS.map((m) => (
          <button
            key={m}
            type="button"
            className="mchip"
            aria-pressed={model === m}
            disabled={busy}
            onClick={() => setModel(m)}
          >
            {m}
          </button>
        ))}
        <input
          className="mchip-input"
          aria-label="Custom model label"
          maxLength={MODEL_LABEL_LEN}
          value={custom ? model : ""}
          disabled={busy}
          placeholder="or type a label"
          onChange={(e) => setModel(e.target.value)}
        />
      </div>

      {steps.length ? <PublishSteps steps={steps} /> : null}

      {!ready ? (
        <p className="note" style={{ marginTop: 16 }}>
          {wallet.publicKey
            ? "Opening the TEE rollup session. Approve the signature request from your wallet."
            : "Connect a wallet that can sign messages to post a job."}
        </p>
      ) : null}
    </form>
  );
}
