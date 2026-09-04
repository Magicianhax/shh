import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CloseIcon } from "./components/icons";

export type Tone = "ok" | "err";

type Toast = { id: number; tone: Tone; text: string };

type Notify = (tone: Tone, text: string) => void;

const Ctx = createContext<Notify>(() => {});

export const useNotify = (): Notify => useContext(Ctx);

const LIFETIME_MS = 3000;

/** Bottom-right, black, mono, three seconds. Text arrives already sanitised. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback<Notify>(
    (tone, text) => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-3), { id, tone, text }]);
      window.setTimeout(() => dismiss(id), LIFETIME_MS);
    },
    [dismiss],
  );

  return (
    <Ctx.Provider value={notify}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <p>{t.text}</p>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <CloseIcon size={12} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
