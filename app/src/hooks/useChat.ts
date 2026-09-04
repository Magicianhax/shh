import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  createJob,
  escrowPda,
  finishJob,
  jobPrivatePda,
  permissionPda,
  publishJob,
  readPrivate,
  settleDirect,
  waitForUndelegation,
} from "@inference-market/client";
import type { Market } from "./useMarket";
import type { ChatMsg, Conversation, Store } from "../lib/chat";
import {
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
 * One user message becomes one job: `createJob` on devnet, then `publishJob`,
 * which delegates the pair to the TEE validator, opens the rollup permissions
 * and streams the prompt in. The pending assistant message then polls the
 * rollup copy of the job until a provider claims it, answers it, and the output
 * can be read back through `readPrivate`.
 *
 * Settlement is a two-phase machine on purpose. `finishJob` is the only step
 * that can be retried safely as a whole; once it lands, the decision is on
 * chain and the message stays in "settling" until the escrow actually reads
 * paid. Polling never rewinds a message out of "settling", and one flag records
 * that a decision was attempted so a failure can never loop the wallet.
 */
export function useChat(market: Market) {
  const { base, er, router, validator, wallet, connection } = market;
  const owner = wallet.publicKey ?? null;

  const [store, setStore] = useState<Store>(() => loadStore());
  const [busy, setBusy] = useState(false);
  const publishWatcher = useRef(0);
  const sending = useRef(false);
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    saveStore(store);
  }, [store]);

  const active = useMemo(
    () => store.convs.find((c) => c.id === store.activeId) ?? null,
    [store],
  );

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

  const stopPublishWatcher = useCallback(() => {
    if (publishWatcher.current) window.clearInterval(publishWatcher.current);
    publishWatcher.current = 0;
  }, []);

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
      const clock = [performance.now()];
      const closeStep = (i: number) => {
        const now = performance.now();
        const started = clock[i] ?? now;
        const ms = now - started;
        clock[i + 1] = now;
        // Steps 2 and 3 are rollup calls; step 0 is a base-layer transaction and
        // step 1 is the router observing delegation, so neither is rollup latency.
        if (i >= 2) recordStep(ms);
        patchMsg(convId, botId, (m) => ({
          ...m,
          steps: (m.steps ?? freshSteps()).map((s, k) => (k === i ? { ...s, done: true, ms } : s)),
        }));
      };

      let stage = 0;

      try {
        const nonce = nextNonce();
        const deadlineUnix = Math.floor(Date.now() / 1000) + conv.minutes * 60;
        const prompt = buildPrompt(history, text);

        const { job } = await createJob(
          base,
          owner,
          nonce,
          conv.priceLamports,
          deadlineUnix,
          conv.model,
        );
        closeStep(0);
        stage = 1;

        patchMsg(convId, botId, (m) => ({ ...m, job: job.toBase58(), deadlineUnix }));

        // Watch the two phases inside `publishJob` that can be observed. The
        // handle lives in a ref so unmounting clears it.
        let seenDelegated = false;
        stopPublishWatcher();
        publishWatcher.current = window.setInterval(() => {
          void (async () => {
            try {
              if (!seenDelegated) {
                const status: any = await router.getDelegationStatus(job);
                if (status?.isDelegated) {
                  seenDelegated = true;
                  closeStep(1);
                  stage = 2;
                }
                return;
              }
              const perm = await er.provider.connection.getAccountInfo(
                permissionPda(jobPrivatePda(job)),
                "confirmed",
              );
              if (perm) {
                closeStep(2);
                stage = 3;
                stopPublishWatcher();
              }
            } catch {
              /* transient RPC hiccups must not fail the publish */
            }
          })();
        }, 700);

        await publishJob(
          { base, er },
          router,
          owner,
          nonce,
          validator,
          new TextEncoder().encode(prompt),
        );
        stopPublishWatcher();

        // Close whatever the watcher did not observe before the call returned.
        patchMsg(convId, botId, (m) => {
          const now = performance.now();
          return {
            ...m,
            state: "open",
            steps: (m.steps ?? freshSteps()).map((s, k) => ({
              ...s,
              done: true,
              ms: s.ms ?? now - (clock[k] ?? clock[0]),
            })),
          };
        });
      } catch (e) {
        stopPublishWatcher();
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
    [active, base, er, owner, patchConv, patchMsg, router, startConversation, stopPublishWatcher, validator],
  );

  // ---- settlement ---------------------------------------------------------

  /**
   * Phase two, and only phase two. The decision is already on chain, so this
   * never rewinds the message; a failure here surfaces inline with a retry that
   * re-runs exactly this half.
   *
   * A scheduled Magic Action may pay the escrow on its own, so wait for that
   * before spending a signature: poll `Escrow.paid` for up to a minute, call
   * `settleDirect` once if it is still unpaid, then check again.
   */
  const settlePhase = useCallback(
    async (convId: string, msgId: string, jobKey: string, kind: "approve" | "reject") => {
      if (!base || !owner) return;
      const job = new PublicKey(jobKey);
      const escrow = escrowPda(job);
      const done = () =>
        patchMsg(convId, msgId, (m) => ({
          ...m,
          state: kind === "approve" ? "settled" : "rejected",
          settleError: null,
        }));

      const paid = async (): Promise<boolean> => {
        const e: any = await base.account.escrow.fetchNullable(escrow);
        // A closed escrow means the job was settled and cleaned up.
        return e === null ? true : Boolean(e.paid);
      };

      try {
        patchMsg(convId, msgId, (m) => ({ ...m, settleError: null }));
        await waitForUndelegation(connection, job);

        const deadline = Date.now() + SETTLE_WAIT_MS;
        while (Date.now() < deadline) {
          if (await paid()) {
            done();
            return;
          }
          await sleep(SETTLE_POLL_MS);
        }

        const sig = await settleDirect(base, owner, job);
        patchMsg(convId, msgId, (m) => ({ ...m, sig }));
        if (await paid()) {
          done();
          return;
        }
        patchMsg(convId, msgId, (m) => ({
          ...m,
          settleError: "settled on chain but the escrow still reads unpaid",
        }));
      } catch (e) {
        patchMsg(convId, msgId, (m) => ({ ...m, settleError: errText(e) }));
      }
    },
    [base, connection, owner, patchMsg],
  );

  /** Retry the settle half only. The decision itself is never sent twice. */
  const retrySettle = useCallback(
    (convId: string, msgId: string) => {
      const msg = storeRef.current.convs
        .find((c) => c.id === convId)
        ?.messages.find((m) => m.id === msgId);
      if (!msg?.job || !msg.decision) return;
      void settlePhase(convId, msgId, msg.job, msg.decision);
    },
    [settlePhase],
  );

  /**
   * Phase one: send the decision. `decisionAttempted` is set before the call and
   * never cleared, so auto-approve cannot fire again whatever happens next.
   */
  const decide = useCallback(
    async (convId: string, msgId: string, kind: "approve" | "reject", funded: boolean) => {
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
        error: null,
        settleError: null,
      }));

      try {
        await finishJob(er, owner, job, kind, funded);
      } catch (e) {
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

      await settlePhase(convId, msgId, msg.job, kind);
    },
    [er, owner, patchMsg, settlePhase],
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
            patchMsg(convId, msgId, (m) =>
              !isPollable(m) || (m.state === "submitted" && m.text === text)
                ? m
                : { ...m, state: "submitted", provider, text, answeredMs },
            );
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

  useEffect(() => stopPublishWatcher, [stopPublishWatcher]);

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
    ready: Boolean(base && er && validator && owner),
  };
}
