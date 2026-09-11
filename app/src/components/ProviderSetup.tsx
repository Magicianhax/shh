import { useState } from "react";
import { CheckIcon } from "./icons";
import { useNotify } from "../notify";

type Props = {
  /** Null until a wallet is connected. */
  owner: string | null;
  /** True once this wallet has a `Provider` account on chain. */
  registered: boolean;
  /** Jobs this wallet has ever claimed. Null while still reading. */
  claimed: number | null;
};

const REPO = "https://github.com/Magicianhax/shh";

/**
 * How to actually become a provider.
 *
 * Registering writes a row on chain and earns nothing on its own: a provider
 * only makes money while a worker process is running with the same key, polling
 * the rollup and answering jobs. The page used to say that once, in grey, in the
 * empty state under a table — and said nothing at all to a wallet that had
 * already registered, which is the exact moment someone is waiting to be told
 * what comes next.
 *
 * So the two steps are stated up front, in every state, each showing whether
 * this wallet has done it.
 */
export function ProviderSetup({ owner, registered, claimed }: Props) {
  const notify = useNotify();
  const [open, setOpen] = useState(false);

  // Nothing has been claimed yet, so the worker has never successfully run.
  const workerSeen = claimed !== null && claimed > 0;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("ok", `${what} copied`);
    } catch {
      notify("err", "copy failed · select it by hand");
    }
  };

  const commands = [
    "git clone https://github.com/Magicianhax/shh.git",
    "cd shh && npm install",
    "cp worker/.env.example worker/.env   # add your key and model backend",
    "npm run start --workspace worker",
  ].join("\n");

  return (
    <section className="setup">
      <div className="setup-head">
        <h3>Run a provider</h3>
        <p>
          Two things have to be true before you earn: your wallet is registered, and a worker
          is running with that same key. Registering alone pays nothing.
        </p>
      </div>

      <ol className="setup-steps">
        <li className={registered ? "is-done" : undefined}>
          <span className="setup-mark" aria-hidden="true">
            {registered ? <CheckIcon size={13} /> : "1"}
          </span>
          <div>
            <b>Register this wallet</b>
            <span>
              {!owner
                ? "Connect the wallet your worker will sign with, then register it below."
                : registered
                  ? "Done. This wallet is in the registry."
                  : "Use the form below. It writes one row on chain and costs a little devnet SOL."}
            </span>
          </div>
        </li>

        <li className={workerSeen ? "is-done" : undefined}>
          <span className="setup-mark" aria-hidden="true">
            {workerSeen ? <CheckIcon size={13} /> : "2"}
          </span>
          <div>
            <b>Run the worker with that key</b>
            <span>
              {workerSeen
                ? "Done. This wallet has claimed jobs, so a worker has run with it."
                : "Nothing has been claimed by this wallet yet. The worker is what watches the rollup, answers jobs, and collects the payout."}
            </span>
          </div>
        </li>
      </ol>

      <div className="setup-actions">
        <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide setup" : "How to run the worker"}
        </button>
        <a className="arrow" href={REPO} target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </div>

      {open ? (
        <div className="setup-detail">
          <p>
            You need a Solana keypair holding a little devnet SOL for fees, and one model
            backend: an Anthropic or OpenAI API key, or an Ollama server running locally. The
            worker serves every model that backend offers, and you set a price floor per model
            so cheaper jobs stay open for someone else.
          </p>
          <pre className="setup-code">
            <code>{commands}</code>
          </pre>
          <div className="setup-actions">
            <button type="button" className="btn btn-sm" onClick={() => void copy(commands, "Commands")}>
              Copy commands
            </button>
            {owner ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void copy(owner, "Address")}
              >
                Copy this address
              </button>
            ) : null}
          </div>
          <p className="setup-note">
            The worker needs the private key for the wallet you registered, so run it somewhere
            you trust. Shh only ever talks to devnet.
          </p>
        </div>
      ) : null}
    </section>
  );
}
