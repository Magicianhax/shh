import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PROMPT_MAX } from "@inference-market/client";
import { Message } from "../components/Message";
import { PillMenu } from "../components/PillMenu";
import { CloseIcon, MenuIcon, Mark, PlusIcon, SendIcon } from "../components/icons";
import { useActionEscrow } from "../hooks/useActionEscrow";
import { useChat } from "../hooks/useChat";
import type { Market } from "../hooks/useMarket";
import { useNow } from "../hooks/useNow";
import { useTee } from "../hooks/useTee";
import { useBalance } from "../hooks/useBalance";
import { contextBytes, groupByDay } from "../lib/chat";
import { LAMPORTS, byteLen, capBytes, shortKey } from "../lib/format";
import { Link } from "../router";
import { useNotify } from "../notify";

const MODELS = [
  { label: "claude", value: "claude" },
  { label: "gpt-4o-mini", value: "gpt-4o-mini" },
  { label: "llama-3.1-8b", value: "llama-3.1-8b" },
];

const PRICES = [0.002, 0.005, 0.01, 0.025, 0.05].map((v) => ({
  label: `${v.toFixed(3)} SOL`,
  value: String(Math.round(v * LAMPORTS)),
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
  const now = useNow();
  const tee = useTee();
  const owner = market.wallet.publicKey ?? null;
  const lamports = useBalance(market.connection, owner);
  const actionEscrow = useActionEscrow(market.connection, market.wallet);

  const [draft, setDraft] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const active = chat.active;
  const groups = useMemo(() => groupByDay(chat.convs), [chat.convs]);

  const history = active?.messages ?? [];
  const ctx = useMemo(() => contextBytes(history, draft), [history, draft]);
  const over = ctx > PROMPT_MAX;

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

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || chat.busy || over) return;
    if (!chat.ready) {
      notify("err", owner ? "opening the rollup session…" : "connect a wallet first");
      return;
    }
    setDraft("");
    void chat.send(text);
  }, [chat, draft, notify, over, owner]);

  const decide = useCallback(
    (msgId: string, kind: "approve" | "reject") => {
      if (!active) return;
      void chat.decide(active.id, msgId, kind, actionEscrow.funded);
    },
    [active, actionEscrow.funded, chat],
  );

  // Auto-approve on read, per conversation.
  useEffect(() => {
    if (!active?.autoApprove) return;
    const target = active.messages.find((m) => m.state === "submitted" && m.text);
    if (!target) return;
    const id = window.setTimeout(
      () => void chat.decide(active.id, target.id, "approve", actionEscrow.funded),
      600,
    );
    return () => window.clearTimeout(id);
  }, [active, actionEscrow.funded, chat]);

  const price = active?.priceLamports ?? 10_000_000;
  const minutes = active?.minutes ?? 30;
  const model = active?.model ?? "claude";

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
            Inference Market
          </Link>
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
                <button
                  key={c.id}
                  type="button"
                  className="conv"
                  aria-current={c.id === active?.id}
                  onClick={() => {
                    chat.selectConversation(c.id);
                    setRailOpen(false);
                  }}
                >
                  <span>{c.title}</span>
                  <button
                    type="button"
                    className="conv-x"
                    aria-label={`Delete ${c.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      chat.deleteConversation(c.id);
                    }}
                  >
                    <CloseIcon size={12} />
                  </button>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="rail-card">
          <div className="rail-row">
            <span>Model</span>
            <span className="mono">{model}</span>
          </div>
          <div className="rail-row">
            <span>Per message</span>
            <span className="mono">{(price / LAMPORTS).toFixed(3)} SOL</span>
          </div>
          <div className="rail-row">
            <span id="auto-label">Auto-approve on read</span>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={Boolean(active?.autoApprove)}
              aria-labelledby="auto-label"
              disabled={!active}
              onClick={() => active && chat.setSettings(active.id, { autoApprove: !active.autoApprove })}
            >
              <i />
            </button>
          </div>
        </div>

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
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink-2)" }}
              title={tee.detail}
            >
              <i className={`dot ${tee.live ? "dot-live" : tee.live === false ? "dot-bad" : "dot-wait"}`} />
              {tee.label}
            </span>
          </div>
          <nav className="thread-links">
            <Link to="/jobs">Jobs</Link>
            <Link to="/provider">Provider</Link>
          </nav>
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
                    <button
                      key={e}
                      type="button"
                      className="example"
                      onClick={() => {
                        setDraft(e);
                        boxRef.current?.focus();
                      }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              history.map((m) => (
                <Message
                  key={m.id}
                  msg={m}
                  now={now}
                  busy={chat.busy}
                  onDecide={(kind) => decide(m.id, kind)}
                />
              ))
            )}
            <div ref={endRef} />
          </div>
        </div>

        <div className="composer-wrap">
          <div className="composer">
            <textarea
              ref={boxRef}
              value={draft}
              aria-label="Message"
              placeholder="Message the model privately…"
              rows={1}
              onChange={(e) => setDraft(capBytes(e.target.value, PROMPT_MAX))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />

            <div className={`meter${over ? " over" : ""}`}>
              <i style={{ ["--p" as never]: Math.min(1, ctx / PROMPT_MAX) }} />
            </div>

            <div className="composer-bar">
              <PillMenu
                name="Model"
                label={model}
                value={model}
                options={MODELS}
                disabled={!active && chat.convs.length > 0}
                onChange={(v) => {
                  const conv = active ?? chat.startConversation();
                  chat.setSettings(conv.id, { model: v });
                }}
              />
              <PillMenu
                name="Price per message"
                label={`${(price / LAMPORTS).toFixed(3)} SOL`}
                value={String(price)}
                options={PRICES}
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
                context {ctx.toLocaleString()} / {PROMPT_MAX.toLocaleString()} bytes
              </span>

              <button
                type="button"
                className="send"
                aria-label="Send"
                disabled={!draft.trim() || chat.busy || over}
                onClick={submit}
              >
                {chat.busy ? <i className="spin" /> : <SendIcon />}
              </button>
            </div>

            {byteLen(draft) >= PROMPT_MAX ? (
              <p className="notice">message is at the 4,096-byte cap</p>
            ) : null}
            {over ? (
              <p className="notice">
                this conversation no longer fits in one job; start a new chat
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
