import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive action: red confirm button, and focus starts on Cancel so Enter can't confirm by accident. */
  danger?: boolean;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

interface OpenDialog extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

/** Provides `useConfirm`: one styled dialog for the whole app instead of the browser's native confirm. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);

  const confirm = useCallback<Confirm>((options) => new Promise<boolean>((resolve) => {
    setDialog((previous) => {
      // A new request replaces an unanswered one, which counts as cancelled
      previous?.resolve(false);
      return { ...options, resolve };
    });
  }), []);

  const close = useCallback((confirmed: boolean) => {
    setDialog((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && <ConfirmDialogView dialog={dialog} onClose={close} />}
    </ConfirmContext.Provider>
  );
}

/** Returns `confirm(options)`, resolving to true when the user confirms. Must be used inside `ConfirmProvider`. */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside ConfirmProvider");
  return confirm;
}

function ConfirmDialogView({ dialog, onClose }: { dialog: OpenDialog; onClose: (confirmed: boolean) => void }) {
  const titleId = useId();
  const messageId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the safe choice, trap Tab inside the dialog, cancel on Escape, and hand focus back afterwards
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (dialog.danger ? cancelRef : confirmRef).current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose(false);
      } else if (e.key === "Tab") {
        const buttons = [cancelRef.current, confirmRef.current].filter((b): b is HTMLButtonElement => b !== null);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        buttons[(index + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
      }
    };
    // Capture phase: the dialog handles keys before page shortcuts (e.g. the canvas's Delete or Escape)
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [dialog, onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={dialog.message ? messageId : undefined}
        className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 shadow-xl"
      >
        <div className="flex gap-3 p-5">
          {dialog.danger && (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-900/50 text-red-300">
              <TriangleAlert size={18} />
            </span>
          )}
          <div className="min-w-0 space-y-1.5">
            <h2 id={titleId} className="text-sm font-semibold text-gray-100">{dialog.title}</h2>
            {dialog.message && <div id={messageId} className="text-sm text-gray-400">{dialog.message}</div>}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-800 px-5 py-3">
          <button
            ref={cancelRef}
            onClick={() => onClose(false)}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {dialog.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            onClick={() => onClose(true)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${
              dialog.danger ? "bg-red-600 hover:bg-red-500 focus-visible:ring-red-500" : "bg-indigo-600 hover:bg-indigo-500 focus-visible:ring-indigo-500"
            }`}
          >
            {dialog.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
