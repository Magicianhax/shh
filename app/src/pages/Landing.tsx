import { ArrowIcon, CheckIcon, GlobeIcon, LockIcon, Mark } from "../components/icons";
import { ThemeToggle } from "../components/ThemeToggle";
import { Link } from "../router";
import { useLastStepMs, msText } from "../lib/latency";

const STEPS = [
  {
    n: "01",
    t: "Post",
    d: "Write up to 4,096 bytes, set a price and a deadline. The prompt is written into the rollup behind a read permission only you hold.",
  },
  {
    n: "02",
    t: "Claim",
    d: "A provider claims the job. Only then is their wallet added to the permission list, and only then can they read the prompt.",
  },
  {
    n: "03",
    t: "Answer",
    d: "The output is written back into the same sealed account. Its hash is recorded so nobody can swap it later.",
  },
  {
    n: "04",
    t: "Approve",
    d: "You read the answer and approve. The prompt is wiped, the account leaves the rollup, and the escrow pays the provider in the same Solana transaction.",
  },
];

export function Landing() {
  const ms = useLastStepMs();

  return (
    <div className="landing">
      <div className="wash" />

      <div className="wrap">
        <div className="nav">
          <span className="brand">
            <Mark size={26} />
            Shh
          </span>
          <div className="nav-links">
            <a href="#/chat">Product</a>
            <Link to="/provider">Providers</Link>
            <a
              href="https://github.com/magicblock-labs/ephemeral-rollups-sdk"
              target="_blank"
              rel="noreferrer"
            >
              Docs
            </a>
            <ThemeToggle />
            <Link to="/chat" className="btn btn-ink">
              Open app
            </Link>
          </div>
        </div>

        <div className="hero">
          <div className="hero-col">
            <h1 className="rise d1" style={{ margin: 0 }}>
              Ask anything.
              <br />
              Only the provider
              <br />
              you choose can read it.
            </h1>
            <p className="hero-lede rise d3">
              Your prompt is sealed inside a TEE-backed rollup. A provider answers it there. You pay
              only when you approve, and the escrow settles on Solana in one transaction.
            </p>
            <p className="rise d3" style={{ margin: "4px 0 0", fontWeight: 500, color: "var(--acc-deep)" }}>
              The chain sees the money, never the words.
            </p>
            <div className="hero-cta rise d4">
              <Link to="/chat" className="btn btn-acc btn-lg">
                Post a private job
              </Link>
              <Link to="/provider" className="arrow">
                Run a provider node
                <ArrowIcon />
              </Link>
            </div>
          </div>

          {/* The same message, twice: what the chain sees, what the two parties see. */}
          <div className="views rise d3">
            <div className="views-chain">
              <div className="views-label">What Solana sees</div>
              <dl className="views-rows mono">
                <div className="views-row">
                  <dt>job</dt>
                  <dd>7pgz…9WW3</dd>
                </div>
                <div className="views-row">
                  <dt>requester</dt>
                  <dd>5GD6…hkjV</dd>
                </div>
                <div className="views-row">
                  <dt>provider</dt>
                  <dd>9hE2…kLmQ</dd>
                </div>
                <div className="views-rule" />
                <div className="views-row">
                  <dt>prompt</dt>
                  <dd className="views-hash">sha256 a91f4c…c04e</dd>
                </div>
                <div className="views-row">
                  <dt>output</dt>
                  <dd className="views-hash">sha256 5be31a…77a0</dd>
                </div>
                <div className="views-rule" />
                <div className="views-row">
                  <dt>escrow</dt>
                  <dd>0.010 SOL → provider</dd>
                </div>
                <div className="views-row">
                  <dt>status</dt>
                  <dd className="views-status">
                    <i />
                    settled · 1 tx
                  </dd>
                </div>
              </dl>
              <p className="views-foot">
                Hashes, amounts, and status. Not one word of the exchange.
              </p>
            </div>

            <div className="views-divider">
              <span className="mono">only hashes cross</span>
            </div>

            <div className="views-parties">
              <div className="views-label acc">What you and your provider see</div>
              <p className="views-said">
                Summarize the Q3 trial notes into five bullet points. Keep dosage numbers exact.
              </p>
              <div className="views-reply">
                <span className="views-seal">
                  <LockIcon size={12} />
                </span>
                <p>
                  Enrollment reached 412 of 450 by week 11. Mean dose 150 mg held; two deviations at
                  125 mg. Three grade-2 adverse events, all resolved. Endpoint trending 18% above
                  placebo. Continue without amendment.
                </p>
              </div>
              <div className="views-settled">
                <span>
                  <CheckIcon size={13} />
                  Approved · paid 0.010 SOL
                </span>
                <span className="mono">3.8 s</span>
              </div>
            </div>
          </div>
        </div>

        <div className="proof rise d5">
          <div>
            <b>{ms !== null ? msText(ms) : "—"}</b>
            <span>rollup step latency, measured</span>
          </div>
          <div>
            <b>SHA-256</b>
            <span>prompt and output committed on-chain</span>
          </div>
          <div>
            <b>1 tx</b>
            <span>approval, undelegation and payout together</span>
          </div>
          <div>
            <b>0 SOL</b>
            <span>paid if you reject</span>
          </div>
        </div>

        <div className="split">
          <div className="split-head">
            <h2>Four steps, one of them yours.</h2>
          </div>
          <div className="steps4">
            {STEPS.map((s) => (
              <div className="step4" key={s.n}>
                <em>{s.n}</em>
                <b>{s.t}</b>
                <span>{s.d}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="split">
          <div className="split-head">
            <h2>Public ledger, private words.</h2>
            <p style={{ fontSize: 15, lineHeight: 1.55, color: "var(--ink-3)" }}>
              Everything money-related is verifiable on Solana. Everything language-related never
              leaves the enclave in the clear.
            </p>
          </div>

          <div className="two">
            <div className="ledger">
              <div className="ledger-head">
                <GlobeIcon />
                Visible on Solana
              </div>
              <div className="ledger-body">
                <div className="ledger-row">
                  <span>Price and escrow</span>
                  <span className="mono muted">0.010 SOL</span>
                </div>
                <div className="ledger-row">
                  <span>Job status</span>
                  <span className="mono muted">Submitted</span>
                </div>
                <div className="ledger-row">
                  <span>Prompt hash</span>
                  <span className="mono muted">a91f…c04e</span>
                </div>
                <div className="ledger-row">
                  <span>Output hash</span>
                  <span className="mono muted">5be3…77a0</span>
                </div>
              </div>
            </div>

            <div className="ledger dark">
              <div className="ledger-head">
                <LockIcon />
                Sealed in the rollup
              </div>
              <div className="ledger-body">
                <div className="ledger-row">
                  <span>Prompt text</span>
                  <span className="mono">you · provider</span>
                </div>
                <div className="ledger-row">
                  <span>Model output</span>
                  <span className="mono">you · provider</span>
                </div>
                <div className="ledger-row">
                  <span>After approval</span>
                  <span className="mono">zeroed before commit</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <section className="split trust-sec">
          <div className="split-head">
            <h2>Escrow, not goodwill.</h2>
            <p className="lede-sm">
              The price is locked before a provider sees the job and moves only when the
              requester decides. Everything below is what the program enforces, and what it
              deliberately does not.
            </p>
          </div>
          <div className="trust-grid">
            <div className="trust-col">
              <div className="trust-col-head">Enforced on chain</div>
              <ul>
                <li>The price leaves the requester at posting and is held by the program, not by either party.</li>
                <li>A provider can read the prompt only after claiming, and only that provider and the requester ever can.</li>
                <li>Approval pays the provider; rejection refunds the requester. Neither can be replayed.</li>
                <li>The prompt and the answer are wiped before the accounts return to Solana; only their hashes remain.</li>
                <li>An hour past the deadline anyone may approve, so an absent requester cannot strand a provider.</li>
              </ul>
            </div>
            <div className="trust-col trust-col-gap">
              <div className="trust-col-head">Still trust, not proof</div>
              <ul>
                <li>Nothing attests which model actually ran. The enclave protects the prompt, not the provider’s honesty.</li>
                <li>A requester can reject a good answer and keep both it and the refund. The only cost is the provider’s public rejected count.</li>
                <li>No arbitration, no staking, no slashing.</li>
                <li>Reputation is two counters. It is not a rating and it cannot be appealed.</li>
                <li>Devnet only. Nothing here has been audited.</li>
              </ul>
            </div>
          </div>
        </section>

        <div className="providers">
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <h2>Bring a model. Get paid on approval.</h2>
            <p
              style={{
                maxWidth: 560,
                fontSize: 16,
                lineHeight: 1.55,
                color: "var(--ink-3)",
              }}
            >
              Run the worker with an OpenAI, Anthropic, or Ollama backend and it serves every model
              that backend offers. You set a price floor per model, so jobs priced under it stay
              open for someone else. Payouts land in your wallet the moment a requester approves.
            </p>
            <Link to="/provider" className="arrow" style={{ marginTop: 6 }}>
              Open the provider dashboard
              <ArrowIcon />
            </Link>
          </div>

          <div className="stat-card">
            <div style={{ fontSize: 12, color: "var(--muted-2)" }}>
              <span>Sample provider · devnet</span>
              <span className="mono">illustrative</span>
            </div>
            <div>
              <span className="muted">Earned</span>
              <span className="mono">0.912 SOL</span>
            </div>
            <div>
              <span className="muted">Completed</span>
              <span className="mono">128</span>
            </div>
            <div>
              <span className="muted">Rejected</span>
              <span className="mono">3</span>
            </div>
            <div style={{ height: 1, background: "var(--hair)", margin: "4px 0" }} />
            <div>
              <span className="muted">Your numbers</span>
              <Link to="/provider" className="mono" style={{ color: "var(--acc-deep)" }}>
                open dashboard
              </Link>
            </div>
          </div>
        </div>

        <div className="foot">
          <span>Shh · Solana devnet · MagicBlock TEE rollup</span>
          <span className="mono">Sample figures above are illustrative, not on-chain reads.</span>
        </div>
      </div>
    </div>
  );
}
