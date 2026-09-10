import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_MODEL_ID, modelById, priceLamports } from "@inference-market/client";
import { FaucetBanner } from "../components/FaucetBanner";
import { Message } from "../components/Message";
import { ModelPicker } from "../components/ModelPicker";
import { PillMenu } from "../components/PillMenu";
import { ThemeToggle } from "../components/ThemeToggle";
import { WalletChip } from "../components/WalletChip";
import { CloseIcon, MenuIcon, Mark, PlusIcon, SendIcon } from "../components/icons";
import { useChat } from "../hooks/useChat";
import type { Market } from "../hooks/useMarket";
import { useNow } from "../hooks/useNow";
import { useTee } from "../hooks/useTee";
import { useBalance } from "../hooks/useBalance";
import { DEFAULT_PRICE_LAMPORTS, DRAFT_MAX, buildPrompt, capBytes, groupByDay } from "../lib/chat";
import { LAMPORTS, byteLen, shortKey, solText } from "../lib/format";
import { Link } from "../router";
import { useNotify } from "../notify";
import { useWalletConnect } from "../wallet";

const PRICE_LADDER = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05].map((v) =>
  Math.round(v * LAMPORTS),
);

/**
 * The price ladder, with the chosen model's own price folded in and marked.
 *
 * Picking a model moves the price to that model's catalog rate, but the rate is
 * a suggestion: a requester who wants to outbid the floor, or undercut it and
 * wait, edits it here. The model's own rate is always offered so getting back
 * to it never needs a guess.
 */
const priceOptions = (modelPrice: number) =>
  [...new Set([modelPrice, ...PRICE_LADDER])]
    .sort((a, b) => a - b)
    .map((lam) => ({
      label: `${solText(lam)} SOL${lam === modelPrice ? " · model" : ""}`,
      value: String(lam),
    }));

const DEADLINES = [10, 30, 60, 240].map((v) => ({
  label: v >= 60 ? `${v / 60} h` : `${v} min`,
  value: String(v),
}));

const EXAMPLES = [
  "Summarize these meeting notes into five bullet points.",
  "Rewrite this paragraph for a safety board.",
  "Explain this error message and how to fix it.",
];

export function Chat({ market }: { market: Market }) {
  const chat = useChat(market);
  const notify = useNotify();
  const { open: openWallet } = useWalletConnect();
  const now = useNow();
  const tee = useTee();
  const owner = market.wallet.publicKey ?? null;
  const { lamports, refresh: refreshBalance } = useBalance(market.connection, owner);

  const [draft, setDraft] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const active = chat.active;
  const groups = useMemo(() => groupByDay(chat.convs), [chat.convs]);

  const history = active?.messages ?? [];
  const draftBytes = byteLen(draft);
  // `buildPrompt` drops the oldest turns to fit, so only an oversized draft can
  // block a send. The counter the user watches is the draft's own budget, and
  // the builder reports whether it had to trim rather than the page guessing.
  const prompt = useMemo(() => buildPrompt(history, draft), [history, draft]);
  const draftTooLong = draftBytes > DRAFT_MAX;
  const historyTrimmed = prompt.trimmed && !draftTooLong;

  // Grow the box with its content, up to the CSS max-height.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [history.length, active?.id]);

  const connect = useCallback(() => {
    notify("err", "connect a wallet to send");
    openWallet();
  }, [notify, openWallet]);

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || chat.busy || draftTooLong) return;
    if (!owner) {
      connect();
      return;
    }
    if (!chat.ready) {
      notify("err", "opening the rollup session…");
      return;
    }
    setDraft("");
    void chat.send(text);
  }, [chat, connect, draft, draftTooLong, notify, owner]);

  const useExample = useCallback(
    (text: string) => {
      setDraft(capBytes(text, DRAFT_MAX));
      if (!owner) connect();
      else boxRef.current?.focus();
    },
    [connect, owner],
  );

  const decide = useCallback(
    (msgId: string, kind: "approve" | "reject") => {
      if (!active) return;
      void chat.decide(active.id, msgId, kind);
    },
    [active, chat],
  );

  /**
   * Auto-approve on read. Gated on `decisionAttempted`, so a failed decision is
   * never retried automatically, and keyed on the target message so a keystroke
   * cannot restart the timer.
   */
  const convId = active?.id ?? null;
  const autoOn = Boolean(active?.autoApprove);
  const [autoHelp, setAutoHelp] = useState(false);
  const autoTarget = active?.messages.find(
    (m) => m.state === "submitted" && m.text && !m.decisionAttempted,
  );
  const autoTargetId = autoTarget?.id ?? null;
  const decideRef = useRef(chat.decide);
  decideRef.current = chat.decide;

  useEffect(() => {
    if (!autoOn || !convId || !autoTargetId) return;
    const id = window.setTimeout(
      () => void decideRef.current(convId, autoTargetId, "approve"),
      600,
    );
    return () => window.clearTimeout(id);
  }, [autoOn, convId, autoTargetId]);

  const price = active?.priceLamports ?? DEFAULT_PRICE_LAMPORTS;
  const minutes = active?.minutes ?? 30;
  const model = active?.model ?? DEFAULT_MODEL_ID;
  const spec = modelById(model);
  // A model the catalog no longer lists has no rate to compare against, so its
  // price is whatever the conversation stored, and never "custom".
  const modelPrice = spec ? priceLamports(spec) : price;
  const customPrice = price !== modelPrice;

  return (
    <div className="chat">
      <button
        type="button"
        className={`rail-scrim${railOpen ? " open" : ""}`}
        aria-label="Close conversations"
        tabIndex={railOpen ? 0 : -1}
        onClick={() => setRailOpen(false)}
      />

      <aside className={`rail${railOpen ? " open" : ""}`}>
        <div className="rail-brand">
          <Link to="/" className="brand" style={{ fontSize: 15, color: "var(--ink)" }}>
            <Mark size={22} />
            Shh
          </Link>
          <ThemeToggle />
        </div>

        <button
          type="button"
          className="btn btn-ink btn-wide"
          onClick={() => {
            chat.startConversation();
            setRailOpen(false);
            setDraft("");
          }}
        >
          <PlusIcon />
          New chat
        </button>

        <div className="convs">
          {groups.length === 0 ? (
            <p className="empty" style={{ padding: "12px 10px" }}>
              no conversations yet
            </p>
          ) : null}
          {groups.map((g) => (
            <div key={g.label}>
              <h4>{g.label}</h4>
              {g.items.map((c) => (
                <div key={c.id} className="conv-wrap">
                  <button
                    type="button"
                    className="conv"
                    aria-current={c.id === active?.id}
                    onClick={() => {
                      chat.selectConversation(c.id);
                      setRailOpen(false);
                    }}
                  >
                    <span>{c.title}</span>
                  </button>
                  <button
                    type="button"
                    className="conv-x"
                    aria-label={`Delete ${c.title}`}
                    onClick={() => chat.deleteConversation(c.id)}
                  >
                    <CloseIcon size={12} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="rail-card">
          <div className="rail-row">
            <span>Model</span>
            <span className="mono" title={model}>
              {spec?.name ?? model}
            </span>
          </div>
          <div className="rail-row">
            <span>Per message</span>
            <span className="mono">
              {solText(price)} SOL{customPrice ? " · custom" : ""}
            </span>
          </div>
          <div className="rail-row">
            <span id="auto-label">
              Auto-approve on read
              <button
                type="button"
                className="help"
                aria-expanded={autoHelp}
                aria-controls="auto-help"
                onClick={() => setAutoHelp((v) => !v)}
              >
                ?<span className="sr-only">What does auto-approve do?</span>
              </button>
            </span>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={autoOn}
              aria-labelledby="auto-label"
              disabled={!active}
              onClick={() =>
                active && chat.setSettings(active.id, { autoApprove: !active.autoApprove })
              }
            >
              <i />
            </button>
          </div>
          {autoHelp && (
            <p id="auto-help" className="rail-help">
              Off, every answer waits for you to press Approve before the escrow pays the
              provider. On, an answer pays as soon as it appears, so a whole conversation
              costs one signature per message instead of two. Reading the answer first is
              the only moment you can reject it, so leave this off unless you trust the
              provider. It applies to this conversation only.
            </p>
          )}
        </div>

        {/* The thread head drops these on phones, so the rail is the mobile nav. */}
        <nav className="rail-nav">
          <Link to="/jobs">Jobs</Link>
          <Link to="/provider">Provider</Link>
        </nav>

        <div className="rail-wallet">
          <span>{owner ? shortKey(owner) : "not connected"}</span>
          <span>{lamports !== null ? `${(lamports / LAMPORTS).toFixed(2)} SOL` : "—"}</span>
        </div>
      </aside>

      <div className="thread">
        <div className="thread-head">
          <div className="thread-title">
            <button
              type="button"
              className="rail-open"
              aria-label="Conversations"
              onClick={() => setRailOpen(true)}
            >
              <MenuIcon />
            </button>
            <b>{active?.title ?? "New chat"}</b>
            <span className="thread-tee" title={tee.detail}>
              <i
                className={`dot ${tee.live ? "dot-live" : tee.live === false ? "dot-bad" : "dot-wait"}`}
              />
              {tee.label}
            </span>
            <span className="pill pill-static">Devnet</span>
          </div>

          <div className="thread-right">
            <nav className="thread-links">
              <Link to="/jobs">Jobs</Link>
              <Link to="/provider">Provider</Link>
            </nav>
            {/* The chat has no app bar, so the wallet control lives here. */}
            <WalletChip owner={owner} lamports={lamports} />
          </div>
        </div>

        <div className="scroll">
          <div className={history.length === 0 ? "msgs center" : "msgs"}>
            {history.length === 0 ? (
              <div className="blank">
                <h2>Ask anything. Only the provider you choose can read it.</h2>
                <p className="muted" style={{ fontSize: 15 }}>
                  Every message becomes one private job: sealed in the rollup, answered by a
                  provider, paid only when you approve.
                </p>
                <div className="examples">
                  {EXAMPLES.map((e) => (
                    <button key={e} type="button" className="example" onClick={() => useExample(e)}>
                      {e}
                    </button>
                  ))}
                </div>
                {!owner ? (
                  <>
                    <p className="empty" style={{ padding: 0 }}>
                      connect a wallet to send your first message
                    </p>
                    <p className="empty" style={{ padding: 0 }}>
                      Solana devnet · testing is free
                    </p>
                  </>
                ) : null}
              </div>
            ) : (
              history.map((m) => (
                <Message
                  key={m.id}
                  msg={m}
                  now={now}
                  busy={chat.busy}
                  settleRunning={chat.isSettleRunning(m.id)}
                  onDecide={(kind) => decide(m.id, kind)}
                  onRetrySettle={() => active && chat.retrySettle(active.id, m.id)}
                  onRetrySend={() => active && chat.retrySend(active.id, m.id)}
                />
              ))
            )}
            <div ref={endRef} />
          </div>
        </div>

        <div className="faucet-wrap">
          <FaucetBanner owner={owner} lamports={lamports} onFunded={refreshBalance} />
        </div>

        <div className="composer-wrap">
          <div className="composer">
            <textarea
              ref={boxRef}
              value={draft}
              aria-label="Message"
              placeholder="Message the model privately…"
              rows={1}
              onChange={(e) => setDraft(capBytes(e.target.value, DRAFT_MAX))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />

            <div className={`meter${draftTooLong ? " over" : ""}`}>
              <i style={{ ["--p" as never]: Math.min(1, draftBytes / DRAFT_MAX) }} />
            </div>

            <div className="composer-bar">
              <ModelPicker
                value={model}
                onChange={(id) => {
                  const conv = active ?? chat.startConversation();
                  const picked = modelById(id);
                  // Choosing a model sets its price too, so the pair the job is
                  // posted with is the one the picker showed.
                  chat.setSettings(conv.id, {
                    model: id,
                    ...(picked ? { priceLamports: priceLamports(picked) } : {}),
                  });
                }}
              />
              <PillMenu
                name="Price per message"
                label={`${solText(price)} SOL${customPrice ? " · custom" : ""}`}
                value={String(price)}
                options={priceOptions(modelPrice)}
                onChange={(v) => {
                  const conv = active ?? chat.startConversation();
                  chat.setSettings(conv.id, { priceLamports: Number(v) });
                }}
              />
              <PillMenu
                name="Deadline"
                label={minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`}
                value={String(minutes)}
                options={DEADLINES}
                onChange={(v) => {
                  const conv = active ?? chat.startConversation();
                  chat.setSettings(conv.id, { minutes: Number(v) });
                }}
              />
              <span className="ctx">
                {draftBytes.toLocaleString()} / {DRAFT_MAX.toLocaleString()} bytes
                {historyTrimmed ? " · older turns trimmed" : ""}
              </span>

              <button
                type="button"
                className="send"
                aria-label="Send"
                disabled={!draft.trim() || chat.busy || draftTooLong}
                onClick={submit}
              >
                {chat.busy ? <i className="spin" /> : <SendIcon />}
              </button>
            </div>

            {draftTooLong ? (
              <p className="notice">
                this message is too long · trim it to {DRAFT_MAX.toLocaleString()} bytes
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
