import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  createJob,
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
  isLive,
  loadStore,
  newConversation,
  saveStore,
  titleFrom,
} from "../lib/chat";
import { errText, num, statusKey } from "../lib/format";
import { recordStep } from "../lib/latency";

const POLL_MS = 2000;

const uid = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * The chat, and the on-chain job behind every turn.
 *
 * One user message becomes one job: `createJob` on devnet, then `publishJob`,
 * which delegates the pair to the TEE validator, opens the rollup permissions
 * and streams the prompt in. The pending assistant message then polls the
 * rollup copy of the job every two seconds until a provider claims it, answers
 * it, and the output can be read back through `readPrivate`.
 *
 * Step timings are measured, not simulated: `createJob` resolving, the router
 * reporting delegation, and the rollup permission account appearing are three
 * observable events, and the fourth closes when `publishJob` returns.
 */
export function useChat(market: Market) {
  const { base, er, router, validator, wallet, connection } = market;
  const owner = wallet.publicKey ?? null;

  const [store, setStore] = useState<Store>(() => loadStore());
  const [busy, setBusy] = useState(false);
  const watchers = useRef<Record<string, number>>({});

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

  const send = useCallback(
    async (text: string) => {
      if (!base || !er || !validator || !owner || !text.trim()) return;

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
          steps: (m.steps ?? freshSteps()).map((s, k) =>
            k === i ? { ...s, done: true, ms } : s,
          ),
        }));
      };

      let stage = 0;
      let watcher = 0;

      try {
        const nonce = BigInt(Date.now());
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

        patchMsg(convId, botId, (m) => ({
          ...m,
          job: job.toBase58(),
          deadlineUnix,
        }));

        // Watch the two phases inside `publishJob` that can be observed.
        let seenDelegated = false;
        watcher = window.setInterval(() => {
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
                window.clearInterval(watcher);
                watcher = 0;
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
        if (watcher) window.clearInterval(watcher);

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
        if (watcher) window.clearInterval(watcher);
        patchMsg(convId, botId, (m) => ({
          ...m,
          state: "failed",
          error: errText(e),
          steps: (m.steps ?? freshSteps()).map((s, k) =>
            k === stage ? { ...s, failed: true } : s,
          ),
        }));
      } finally {
        setBusy(false);
      }
    },
    [active, base, er, owner, patchConv, patchMsg, router, startConversation, validator],
  );

  // ---- settlement ---------------------------------------------------------

  const decide = useCallback(
    async (convId: string, msgId: string, kind: "approve" | "reject", funded: boolean) => {
      const conv = store.convs.find((c) => c.id === convId);
      const msg = conv?.messages.find((m) => m.id === msgId);
      if (!base || !er || !owner || !msg?.job) return;
      const job = new PublicKey(msg.job);

      patchMsg(convId, msgId, (m) => ({ ...m, state: "settling", error: null }));

      try {
        await finishJob(er, owner, job, kind, funded);

        if (!funded) {
          // No scheduled action could pay, so settle on the base layer once the
          // commit has brought the job back.
          await waitForUndelegation(connection, job);
          const sig = await settleDirect(base, owner, job);
          patchMsg(convId, msgId, (m) => ({
            ...m,
            state: kind === "approve" ? "settled" : "rejected",
            sig,
          }));
          return;
        }

        patchMsg(convId, msgId, (m) => ({
          ...m,
          state: kind === "approve" ? "settled" : "rejected",
        }));
      } catch (e) {
        patchMsg(convId, msgId, (m) => ({ ...m, state: "submitted", error: errText(e) }));
      }
    },
    [base, connection, er, owner, patchMsg, store.convs],
  );

  // ---- polling ------------------------------------------------------------

  const liveKeys = active
    ? active.messages
        .filter((m) => m.role === "assistant" && m.job && isLive(m.state) && m.state !== "publishing")
        .map((m) => `${m.id}:${m.job}`)
        .join(",")
    : "";

  useEffect(() => {
    if (!er || !base || !active || !liveKeys) return;
    const convId = active.id;
    let stopped = false;

    const tick = async () => {
      for (const entry of liveKeys.split(",")) {
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
              m.state === "claimed" && m.provider === provider
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
              m.state === "submitted" && m.text === text
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
  }, [er, base, active, liveKeys, patchMsg]);

  useEffect(() => {
    const timers = watchers.current;
    return () => {
      for (const id of Object.values(timers)) window.clearInterval(id);
    };
  }, []);

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
    /** Exposed for the empty state's example prompts. */
    ready: Boolean(base && er && validator && owner),
  };
}
