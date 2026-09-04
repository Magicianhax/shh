import { useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { PublicKey } from "@solana/web3.js";
import {
  AUTO_APPROVE_SECS,
  MODEL_LABEL_LEN,
  PROMPT_MAX,
  createJob,
  jobPrivatePda,
  permissionPda,
  publishJob,
} from "@inference-market/client";
import { Segmented } from "./Segmented";
import { CheckIcon, LockIcon } from "./icons";
import type { Market } from "../hooks/useMarket";
import { useNotify } from "../notify";
import { byteLen, capBytes, errText, shortKey } from "../lib/format";

type StepState = "idle" | "active" | "done" | "failed";

const STEP_NAMES = ["Create", "Delegate", "Permissions", "Prompt"] as const;

const PRICES = [
  { label: "0.005", value: "0.005" },
  { label: "0.01", value: "0.01" },
  { label: "0.05", value: "0.05" },
  { label: "Custom", value: "custom" },
];

const DEADLINES = [
  { label: "15m", value: "15" },
  { label: "30m", value: "30" },
  { label: "1h", value: "60" },
  { label: "Custom", value: "custom" },
];

type Props = {
  market: Market;
  onPublished: (job: PublicKey) => void;
};

/**
 * Post a job: `createJob` on devnet, then `publishJob`, which delegates both
 * PDAs to the TEE validator, opens the ER permissions and streams the prompt in.
 *
 * `publishJob` is one call, so the stepper is driven by what can actually be
 * observed while it runs: the router's delegation status, then the ER-local
 * permission account. Nothing here reads or logs the prompt bytes.
 */
export function NewJobForm({ market, onPublished }: Props) {
  const { base, er, router, validator, wallet } = market;
  const notify = useNotify();

  const [model, setModel] = useState("llama-3.1-8b");
  const [priceMode, setPriceMode] = useState("0.01");
  const [priceCustom, setPriceCustom] = useState("0.02");
  const [deadlineMode, setDeadlineMode] = useState("30");
  const [deadlineCustom, setDeadlineCustom] = useState("120");
  const [prompt, setPrompt] = useState("");
  const [steps, setSteps] = useState<StepState[]>(["idle", "idle", "idle", "idle"]);
  const [busy, setBusy] = useState(false);
  const watcher = useRef(0);

  const bytes = byteLen(prompt);
  const fill = Math.min(1, bytes / PROMPT_MAX);
  const priceSol = Number(priceMode === "custom" ? priceCustom : priceMode);
  const mins = Number(deadlineMode === "custom" ? deadlineCustom : deadlineMode);
  const priceLamports = Math.round(priceSol * LAMPORTS_PER_SOL);

  const ready = Boolean(base && er && validator && wallet.publicKey);
  const valid =
    ready &&
    model.trim().length > 0 &&
    Number.isFinite(priceLamports) &&
    priceLamports > 0 &&
    Number.isFinite(mins) &&
    mins >= 1 &&
    bytes > 0;

  const mark = (index: number, state: StepState) =>
    setSteps((prev) => prev.map((s, i) => (i === index ? state : s)));

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
              mark(1, "done");
              mark(2, "active");
            }
            return;
          }
          if (!er) return;
          const perm = await er.provider.connection.getAccountInfo(
            permissionPda(jobPrivatePda(job)),
            "confirmed",
          );
          if (perm) {
            mark(2, "done");
            mark(3, "active");
            window.clearInterval(watcher.current);
            watcher.current = 0;
          }
        } catch {
          /* transient RPC hiccups must not fail the publish */
        }
      })();
    }, 1500);
  };

  const stopWatch = () => {
    if (watcher.current) window.clearInterval(watcher.current);
    watcher.current = 0;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || !base || !er || !validator || !wallet.publicKey) return;

    setBusy(true);
    setSteps(["active", "idle", "idle", "idle"]);
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
      mark(0, "done");
      mark(1, "active");
      stage = 1;
      notify("ok", "Job created on devnet", `Signature ${shortKey(sig, 8)}`);

      watch(job);
      const promptBytes = new TextEncoder().encode(prompt);
      await publishJob({ base, er }, router, wallet.publicKey, nonce, validator, promptBytes);
      stopWatch();

      setSteps(["done", "done", "done", "done"]);
      setPrompt("");
      notify("ok", "Job is open", "The prompt is sealed inside the TEE rollup.");
      onPublished(job);
    } catch (err) {
      stopWatch();
      mark(stage, "failed");
      notify("err", "Publish failed", errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={submit}>
      <div className="panel-body composer">
        <div>
          <label className="label" htmlFor="prompt">
            Prompt
          </label>
          <textarea
            id="prompt"
            value={prompt}
            disabled={busy}
            spellCheck={false}
            onChange={(e) => setPrompt(capBytes(e.target.value, PROMPT_MAX))}
            placeholder="Ask the model something. Nobody outside the enclave and the two wallets on this job can read it."
          />
          <div className={`meter${bytes >= PROMPT_MAX ? " full" : ""}`}>
            <div className="meter-track">
              <i style={{ "--p": fill } as CSSProperties} />
            </div>
            <div className="meter-row">
              <span>
                <LockIcon size={11} /> Sealed in the rollup behind a read permission
              </span>
              <span>
                <b>{bytes.toLocaleString()}</b> / {PROMPT_MAX.toLocaleString()} bytes
              </span>
            </div>
          </div>
        </div>

        <div>
          <div className="field">
            <label className="label" htmlFor="model">
              Model
            </label>
            <input
              id="model"
              value={model}
              maxLength={MODEL_LABEL_LEN}
              disabled={busy}
              onChange={(e) => setModel(e.target.value)}
              placeholder="llama-3.1-8b"
            />
          </div>

          <div className="field">
            <span className="label">Price</span>
            <Segmented
              label="Price in SOL"
              options={PRICES}
              value={priceMode}
              disabled={busy}
              onChange={setPriceMode}
            />
            {priceMode === "custom" ? (
              <div className="seg-custom">
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={priceCustom}
                  disabled={busy}
                  aria-label="Price in SOL"
                  onChange={(e) => setPriceCustom(e.target.value)}
                />
              </div>
            ) : null}
          </div>

          <div className="field">
            <span className="label">Deadline</span>
            <Segmented
              label="Deadline in minutes"
              options={DEADLINES}
              value={deadlineMode}
              disabled={busy}
              onChange={setDeadlineMode}
            />
            {deadlineMode === "custom" ? (
              <div className="seg-custom">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={deadlineCustom}
                  disabled={busy}
                  aria-label="Deadline in minutes"
                  onChange={(e) => setDeadlineCustom(e.target.value)}
                />
              </div>
            ) : null}
            <p className="meter-row" style={{ marginTop: 8 }}>
              <span>
                You alone can approve for {AUTO_APPROVE_SECS / 60} minutes past the deadline.
              </span>
            </p>
          </div>

          <div className="field">
            <button
              type="submit"
              className="btn btn-primary btn-lg btn-wide"
              disabled={!valid || busy}
            >
              {busy ? <i className="spin" /> : <LockIcon size={15} />}
              {busy ? "Publishing" : "Publish privately"}
            </button>
          </div>

          {steps.some((s) => s !== "idle") ? (
            <div className="steps">
              {STEP_NAMES.map((name, i) => (
                <div key={name} className={`pstep ${steps[i]}`}>
                  <div className="track">
                    <i />
                  </div>
                  <span className="pstep-label">
                    <span className="pstep-check">
                      <CheckIcon size={11} />
                    </span>
                    {name}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {!ready ? (
            <p className="note" style={{ marginTop: 16 }}>
              {wallet.publicKey
                ? "Opening the TEE rollup session. Approve the signature request from your wallet."
                : "Connect a wallet that can sign messages to post a job."}
            </p>
          ) : null}
        </div>
      </div>
    </form>
  );
}
