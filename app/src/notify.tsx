import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CloseIcon } from "./components/icons";
import { springy } from "./motion";

export type Tone = "ok" | "err" | "info";

type Toast = { id: number; tone: Tone; title: string; body?: string };

type Notify = (tone: Tone, title: string, body?: string) => void;

const NotifyContext = createContext<Notify>(() => {});

/** Push a toast. Callers pass already-sanitised text. */
export const useNotify = (): Notify => useContext(NotifyContext);

const LIFETIME_MS = 9000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback<Notify>(
    (tone, title, body) => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-4), { id, tone, title, body }]);
      window.setTimeout(() => dismiss(id), LIFETIME_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => notify, [notify]);

  return (
    <NotifyContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              className={`toast ${t.tone}`}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.96 }}
              transition={springy}
            >
              <strong>{t.title}</strong>
              <button
                type="button"
                className="iconbtn"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
              >
                <CloseIcon size={12} />
              </button>
              {t.body ? <p>{t.body}</p> : null}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </NotifyContext.Provider>
  );
}
