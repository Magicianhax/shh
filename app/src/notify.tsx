import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

export type Tone = "ok" | "err" | "info";

type Toast = { id: number; tone: Tone; title: string; body?: string };

type Notify = (tone: Tone, title: string, body?: string) => void;

const NotifyContext = createContext<Notify>(() => {});

/** Read-only hook for pushing a toast. Callers pass already-sanitised text. */
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
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <strong>{t.title}</strong>
            <button
              type="button"
              className="iconbtn"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path
                  d="M2.5 2.5l7 7m0-7l-7 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            {t.body ? <p>{t.body}</p> : null}
          </div>
        ))}
      </div>
    </NotifyContext.Provider>
  );
}
