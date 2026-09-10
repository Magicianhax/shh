import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  ACTION_TOP_UP_LAMPORTS,
  escrowPda,
  finishJob,
  jobPrivatePda,
  openJob,
  readPrivate,
  sealPrompt,
  settleDirect,
  waitForDelegation,
  waitForUndelegation,
} from "@inference-market/client";
import { useActionEscrow } from "./useActionEscrow";
import type { Market } from "./useMarket";
import type { ChatMsg, Conversation, Store } from "../lib/chat";
import {
  EMPTY_READ_LIMIT,
  buildPrompt,
  freshSteps,
  isPollable,
  loadStore,
  newConversation,
  saveStore,
  titleFrom,
} from "../lib/chat";
import { errText, num, statusKey } from "../lib/format";
import { recordStep } from "../lib/latency";

const POLL_MS = 2000;
/** How long to wait for a scheduled settlement before settling by hand. */
const SETTLE_WAIT_MS = 60_000;
const SETTLE_POLL_MS = 3000;

let nonceCounter = 0n;
/** Millisecond-unique, so two messages sent in the same tick get different jobs. */
const nextNonce = (): bigint => {
  nonceCounter = (nonceCounter + 1n) % 1000n;
  return BigInt(Date.now()) * 1000n + nonceCounter;
};

const uid = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The chat, and the on-chain job behind every turn.
 *
 * One user message becomes one job and costs two wallet approvals. `openJob`
 * packs `create_job`, both delegate instructions and — on the first message a
 * wallet sends — the action-escrow top-up into a single devnet transaction.
 * `sealPrompt` then signs the whole rollup sequence at once: the permissions,
 * every prompt chunk and the seal. The pending assistant message then polls the
 * rollup copy of the job until a provider claims it, answers it, and the output
 * can be read back through `readPrivate`.
 *
 * Because that top-up rides along, the action escrow is funded from the first
 * message onward, so approving schedules its own payout and there is no third
 * signature to settle. The manual settle path below stays for the cases where
 * that is not true.
 *
 * Settlement is a two-phase machine on purpose. `finishJob` is the only step
 * that can be retried safely as a whole; once it lands, the decision is on
 * chain and the message stays in "settling" until the escrow actually reads
 * paid. Polling never rewinds a message out of "settling", one flag records
 * that a decision was attempted so a failure cannot loop the wallet, and the
 * settle half stops the moment the view goes away, so nothing asks for a
 * signature after the user has left.
 */
export function useChat(market: Market) {
  const { base, er, router, validator, wallet, connection } = market;
  const owner = wallet.publicKey ?? null;

  const ownerKey = owner?.toBase58() ?? null;

  /**
   * The store and the wallet it was loaded for, held as one value on purpose.
   * A wallet switch changes both together, so the save effect can never write
   * the previous wallet's conversations under the new wallet's key. With no
   * wallet connected the store is empty and nothing is persisted.
   */
  const [loaded, setLoaded] = useState<{ owner: string | null; store: Store }>(() => ({
    owner: ownerKey,
    store: loadStore(ownerKey),
  }));
  if (loaded.owner !== ownerKey) {
    setLoaded({ owner: ownerKey, store: loadStore(ownerKey) });
  }
  const store = loaded.store;
  const setStore = useCallback(
    (fn: (s: Store) => Store) => setLoaded((l) => ({ ...l, store: fn(l.store) })),
    [],
  );

  const [busy, setBusy] = useState(false);
  /** Message ids whose settle half is running in this session, right now. */
  const [settling, setSettling] = useState<Record<string, true>>({});
  const sending = useRef(false);
  const storeRef = useRef(store);
  storeRef.current = store;

  /**
   * The ephemeral balance a scheduled `settle_action` is charged to. Held in a
   * ref so `send` and `decide` read the live value without changing identity on
   * every balance refresh.
   */
  const actionEscrow = useActionEscrow(connection, wallet);
  const escrowRef = useRef(actionEscrow);
  escrowRef.current = actionEscrow;

  useEffect(() => {
    saveStore(loaded.owner, loaded.store);
  }, [loaded]);

  const active = useMemo(
    () => store.convs.find((c) => c.id === store.activeId) ?? null,
    [store],
  );

  /**
   * Nothing may prompt the wallet or write state once the chat is gone or the
   * user has switched conversations. A settle run that stops this way leaves the
   * message in "settling", which the UI reports as interrupted with a manual
   * retry; it never resumes on its own.
   */
  const mounted = useRef(true);
  const activeIdRef = useRef(store.activeId);
  activeIdRef.current = store.activeId;
  const alive = useCallback(
    (convId: string) => mounted.current && activeIdRef.current === convId,
    [],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // ---- conversation management -------------------------------------------

  const patchConv = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setStore((s) => ({ ...s, convs: s.convs.map((c) => (c.id === id ? fn(c) : c)) }));
  }, []);

  const patchMsg = useCallback(
    (convId: string, msgId: string, fn: (m: ChatMsg) => ChatMsg) => {
      patchConv(convId, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === msgId ? fn(m) : m)),
      }));
    },
    [patchConv],
  );

  const startConversation = useCallback((): Conversation => {
    const conv = newConversation();
    setStore((s) => ({ convs: [conv, ...s.convs], activeId: conv.id }));
    return conv;
  }, []);

  const selectConversation = useCallback((id: string) => {
    setStore((s) => ({ ...s, activeId: id }));
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setStore((s) => {
      const convs = s.convs.filter((c) => c.id !== id);
      return { convs, activeId: s.activeId === id ? (convs[0]?.id ?? null) : s.activeId };
    });
  }, []);

  const setSettings = useCallback(
    (id: string, patch: Partial<Conversation>) => patchConv(id, (c) => ({ ...c, ...patch })),
    [patchConv],
  );

  // ---- sending ------------------------------------------------------------

  const send = useCallback(
    async (text: string) => {
      if (!base || !er || !validator || !owner || !text.trim()) return;
      if (sending.current) return;
      sending.current = true;

      let conv = active;
      if (!conv) conv = startConversation();
      const convId = conv.id;
      const history = conv.messages;

      const userMsg: ChatMsg = { id: uid(), role: "user", text: text.trim(), at: Date.now() };
      const botId = uid();
      const botMsg: ChatMsg = {
        id: botId,
        role: "assistant",
        text: "",
        at: Date.now(),
        state: "publishing",
        steps: freshSteps(),
        error: null,
        priceLamports: conv.priceLamports,
      };

      patchConv(convId, (c) => ({
        ...c,
        title: c.messages.length === 0 ? titleFrom(text) : c.title,
        at: Date.now(),
        messages: [...c.messages, userMsg, botMsg],
      }));

      setBusy(true);
      /** Mark one of the two publish steps done, with its measured duration. */
      const markStep = (i: number, ms: number, name?: string) => {
        patchMsg(convId, botId, (m) => ({
          ...m,
          steps: (m.steps ?? freshSteps()).map((s, k) =>
            k === i ? { ...s, done: true, ms, name: name ?? s.name } : s,
          ),
        }));
      };

      let stage = 0;

      try {
        const nonce = nextNonce();
        const deadlineUnix = Math.floor(Date.now() / 1000) + conv.minutes * 60;
        const prompt = buildPrompt(history, text);
        // Fold the action-escrow top-up in only while the escrow is empty, so
        // the very first message pays for every later approval to settle itself.
        const topUp = escrowRef.current.funded ? 0 : ACTION_TOP_UP_LAMPORTS;

        // Step one, one signature: create the job, delegate both PDAs and, the
        // first time, fund the action escrow.
        const t0 = performance.now();
        const { job } = await openJob(
          base,
          owner,
          nonce,
          conv.priceLamports,
          deadlineUnix,
          conv.model,
          validator,
          topUp,
        );
        markStep(0, performance.now() - t0);
        stage = 1;

        patchMsg(convId, botId, (m) => ({ ...m, job: job.toBase58(), deadlineUnix }));
        if (topUp > 0) {
          escrowRef.current.markFunded(topUp);
          void escrowRef.current.refresh().catch(() => {});
        }

        // Step two, one signature: the whole rollup sequence. The router wait in
        // front of it is base-layer propagation, not rollup latency, so only the
        // sequence itself is recorded as a step time.
        const t1 = performance.now();
        await waitForDelegation(router, [job, jobPrivatePda(job)]);
        const tSeal = performance.now();
        const { mode } = await sealPrompt(
          er,
          owner,
          job,
          new TextEncoder().encode(prompt.text),
        );
        recordStep(performance.now() - tSeal);
        markStep(
          1,
          performance.now() - t1,
          mode === "sequential" ? "sealing · per-step signing" : undefined,
        );

        patchMsg(convId, botId, (m) => ({ ...m, state: "open" }));
      } catch (e) {
        patchMsg(convId, botId, (m) => ({
          ...m,
          state: "failed",
          error: errText(e),
          steps: (m.steps ?? freshSteps()).map((s, k) =>
            k === stage ? { ...s, failed: true } : s,
          ),
        }));
      } finally {
        sending.current = false;
        setBusy(false);
      }
    },
    [active, base, er, owner, patchConv, patchMsg, router, startConversation, validator],
  );

  // ---- settlement ---------------------------------------------------------

  /**
   * Phase two, and only phase two. The decision is already on chain, so this
   * never rewinds the message; a failure surfaces inline with a retry that
   * re-runs exactly this half.
   *
   * A scheduled Magic Action may pay the escrow on its own, so wait for that
   * before spending a signature: poll `Escrow.paid` for up to a minute, call
   * `settleDirect` once if it is still unpaid, then check again. When the
   * decision scheduled no action, there is nothing to wait for and the wait is
   * skipped entirely; a single `paid` check still runs first, because the
   * provider's reconcile loop may already have settled it.
   *
   * Every step checks `alive(convId)` first. Leaving the chat or switching
   * conversation stops the run before it can prompt the wallet, and the message
   * stays in "settling" for the interrupted-settlement retry to pick up.
   */
  const settlePhase = useCallback(
    async (
      convId: string,
      msgId: string,
      jobKey: string,
      kind: "approve" | "reject",
      scheduled: boolean,
    ) => {
      if (!base || !owner) {
        patchMsg(convId, msgId, (m) => ({ ...m, settleError: "wallet not connected" }));
        return;
      }

      const job = new PublicKey(jobKey);
      const escrow = escrowPda(job);

      const paid = async (): Promise<boolean> => {
        const e: any = await base.account.escrow.fetchNullable(escrow);
        // A closed escrow means the job was settled and cleaned up.
        return e === null ? true : Boolean(e.paid);
      };

      setSettling((s) => ({ ...s, [msgId]: true }));
      try {
        patchMsg(convId, msgId, (m) => ({ ...m, settleError: null }));
        await waitForUndelegation(connection, job);
        if (!alive(convId)) return;

        const settled = () => {
          patchMsg(convId, msgId, (m) => ({
            ...m,
            state: kind === "approve" ? "settled" : "rejected",
            settleError: null,
          }));
        };

        if (scheduled) {
          const deadline = Date.now() + SETTLE_WAIT_MS;
          while (Date.now() < deadline) {
            if (!alive(convId)) return;
            if (await paid()) {
              settled();
              return;
            }
            await sleep(SETTLE_POLL_MS);
          }
        } else if (await paid()) {
          settled();
          return;
        }

        // The last check before a signature is requested.
        if (!alive(convId)) return;
        const sig = await settleDirect(base, owner, job);
        patchMsg(convId, msgId, (m) => ({ ...m, sig }));

        if (await paid()) {
          settled();
          return;
        }
        patchMsg(convId, msgId, (m) => ({
          ...m,
          settleError: "settled on chain but the escrow still reads unpaid",
        }));
      } catch (e) {
        patchMsg(convId, msgId, (m) => ({ ...m, settleError: errText(e) }));
      } finally {
        setSettling((s) => {
          const next = { ...s };
          delete next[msgId];
          return next;
        });
      }
    },
    [alive, base, connection, owner, patchMsg],
  );

  /** Retry the settle half only. The decision itself is never sent twice. */
  const retrySettle = useCallback(
    (convId: string, msgId: string) => {
      const msg = storeRef.current.convs
        .find((c) => c.id === convId)
        ?.messages.find((m) => m.id === msgId);
      if (!msg?.job || !msg.decision) return;
      void settlePhase(convId, msgId, msg.job, msg.decision, msg.actionScheduled ?? false);
    },
    [settlePhase],
  );

  /**
   * Phase one: send the decision. `decisionAttempted` is set before the call and
   * never cleared, so auto-approve cannot fire again whatever happens next.
   *
   * A funded action escrow — the normal case, since the first message tops it up
   * — schedules the payout inside the same commit, so `settlePhase` finishes by
   * observation and never asks for a second signature.
   */
  const decide = useCallback(
    async (convId: string, msgId: string, kind: "approve" | "reject") => {
      const funded = escrowRef.current.funded;
      const msg = storeRef.current.convs
        .find((c) => c.id === convId)
        ?.messages.find((m) => m.id === msgId);
      if (!er || !owner || !msg?.job) return;
      if (msg.state === "settling" || msg.state === "settled" || msg.state === "rejected") return;

      const job = new PublicKey(msg.job);
      patchMsg(convId, msgId, (m) => ({
        ...m,
        state: "settling",
        decision: kind,
        decisionAttempted: true,
        actionScheduled: funded,
        error: null,
        settleError: null,
      }));

      let erSig: string | null = null;
      try {
        const { commitSig } = await finishJob(er, owner, job, kind, funded, (s) => {
          erSig = s;
        });
        patchMsg(convId, msgId, (m) => ({ ...m, erSig, commitSig }));
      } catch (e) {
        const landed: string | null = erSig;
        if (landed === null) {
          // The decision never reached the rollup. Park it in its own state with a
          // manual retry rather than back in "submitted", where auto-approve or a
          // stray poll could fire it again.
          patchMsg(convId, msgId, (m) => ({
            ...m,
            state: "decision_failed",
            error: errText(e),
          }));
          return;
        }
        // The rollup accepted the decision; only the commitment lookup failed.
        // The money is already moving, so this must not go back to a state that
        // re-sends it. Stay in "settling" with the commit recorded as unknown.
        patchMsg(convId, msgId, (m) => ({
          ...m,
          erSig: landed,
          commitSig: null,
          settleError: null,
        }));
      }

      if (!alive(convId)) return;
      await settlePhase(convId, msgId, msg.job, kind, funded);
    },
    [alive, er, owner, patchMsg, settlePhase],
  );

  // ---- polling ------------------------------------------------------------

  const pollKeys = active
    ? active.messages
        .filter((m) => m.role === "assistant" && isPollable(m))
        .map((m) => `${m.id}:${m.job}`)
        .join(",")
    : "";

  useEffect(() => {
    if (!er || !active || !pollKeys) return;
    const convId = active.id;
    let stopped = false;

    const tick = async () => {
      for (const entry of pollKeys.split(",")) {
        const [msgId, jobKey] = entry.split(":");
        if (!jobKey) continue;
        const job = new PublicKey(jobKey);
        try {
          const acct: any = await er.account.job.fetchNullable(job);
          if (stopped) return;
          if (!acct) continue;

          const status = statusKey(acct.status);
          const provider = acct.provider.equals(PublicKey.default)
            ? null
            : acct.provider.toBase58();

          if (status === "claimed") {
            patchMsg(convId, msgId, (m) =>
              // Never rewind a message the user has already decided on.
              !isPollable(m) || (m.state === "claimed" && m.provider === provider)
                ? m
                : { ...m, state: "claimed", provider },
            );
          } else if (status === "submitted") {
            const { output } = await readPrivate(er, job);
            if (stopped) return;
            const text = output.length ? new TextDecoder().decode(output) : "";
            const answeredMs =
              num(acct.submittedAt) > 0 && num(acct.createdAt) > 0
                ? (num(acct.submittedAt) - num(acct.createdAt)) * 1000
                : null;
            patchMsg(convId, msgId, (m) => {
              if (!isPollable(m)) return m;
              if (m.state === "submitted" && m.text === text && text.length > 0) return m;
              // A provider can legitimately seal nothing; count the empty reads
              // so `isPollable` gives up instead of spinning on this job.
              const emptyReads =
                text.length === 0 ? Math.min(EMPTY_READ_LIMIT, (m.emptyReads ?? 0) + 1) : 0;
              return { ...m, state: "submitted", provider, text, answeredMs, emptyReads };
            });
          }
        } catch {
          /* the job may have left the rollup between polls; the next tick retries */
        }
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [er, active, pollKeys, patchMsg]);

  return {
    convs: store.convs,
    active,
    busy,
    startConversation,
    selectConversation,
    deleteConversation,
    setSettings,
    send,
    decide,
    retrySettle,
    /** True while this message's settle half is running in this session. */
    isSettleRunning: (msgId: string) => Boolean(settling[msgId]),
    ready: Boolean(base && er && validator && owner),
  };
}
