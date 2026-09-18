import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";

type Tone = "info" | "success" | "error";

interface Flash {
  id: number;
  tone: Tone;
  message: string;
}

interface ToastApi {
  info: (message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** How long a message stays before it fades; long enough to read, short enough not to nag. */
const LIFETIME_MS = 6000;

const TONE = {
  info: { icon: Info, ring: "border-gray-700", accent: "text-indigo-300" },
  success: { icon: CheckCircle2, ring: "border-emerald-900/70", accent: "text-emerald-300" },
  error: { icon: CircleAlert, ring: "border-red-900/70", accent: "text-red-300" },
} as const;

/**
 * Brief messages that outlive the screen that raised them — "this server already has an account", said while the
 * setup page is on its way to the sign-in screen. Anything the user must act on belongs in the page itself; this is
 * for things that have already happened.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [flashes, setFlashes] = useState<Flash[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setFlashes((current) => current.filter((flash) => flash.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback((tone: Tone, message: string) => {
    const id = nextId.current++;
    setFlashes((current) => [...current, { id, tone, message }]);
    timers.current.set(id, setTimeout(() => dismiss(id), LIFETIME_MS));
  }, [dismiss]);

  // A message outliving its page is the point; one outliving the whole app is a leak
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({
    info: (message) => push("info", message),
    success: (message) => push("success", message),
    error: (message) => push("error", message),
  }), [push]);

  // So non-React callers reach this provider for as long as it is the one on screen
  useEffect(() => {
    outsideReact = api;
    return () => {
      if (outsideReact === api) outsideReact = null;
    };
  }, [api]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-4 z-[200] flex flex-col items-center gap-2 px-4">
        {flashes.map((flash) => {
          const { icon: Icon, ring, accent } = TONE[flash.tone];
          return (
            <div
              key={flash.id}
              role="status"
              className={`pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border ${ring} bg-gray-900/95 px-3.5 py-2.5 shadow-lg shadow-black/40 backdrop-blur`}
            >
              <Icon size={16} className={`mt-0.5 shrink-0 ${accent}`} />
              <span className="min-w-0 flex-1 text-sm text-gray-200">{flash.message}</span>
              <button
                onClick={() => dismiss(flash.id)}
                aria-label="Dismiss"
                className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200"
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * The same messages, for code that runs outside React — the query client's error handler, which has no hooks. It
 * points at whichever provider is mounted, and does nothing before one is.
 */
let outsideReact: ToastApi | null = null;

export const toast: ToastApi = {
  info: (message) => outsideReact?.info(message),
  success: (message) => outsideReact?.success(message),
  error: (message) => outsideReact?.error(message),
};

export function useToast(): ToastApi {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast must be used inside ToastProvider");
  return toast;
}
