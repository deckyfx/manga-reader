import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Buttons for the footer; the modal supplies the separator and spacing. */
  footer?: ReactNode;
  /** Tailwind max-width class for wider forms (default `max-w-lg`). */
  width?: string;
}

/**
 * The app's dialog shell: a styled modal instead of the browser's native dialogs. Escape and a click on the backdrop
 * close it, Tab stays inside, and focus returns to whatever opened it.
 */
export function Modal({ title, onClose, children, footer, width = "max-w-lg" }: ModalProps) {
  const titleId = useId();
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () =>
      Array.from(
        frameRef.current?.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);
    focusable()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab") {
        const items = focusable();
        if (items.length === 0) return;
        const index = items.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        items[(index + (e.shiftKey ? items.length - 1 : 1)) % items.length]?.focus();
      }
    };
    // Capture phase: the dialog takes keys before page shortcuts (the canvas's Delete, the reader's arrows)
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={frameRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full ${width} max-h-[90vh] flex flex-col rounded-xl border border-gray-800 bg-gray-900 shadow-xl`}
      >
        <div className="flex items-center gap-3 border-b border-gray-800 px-5 py-3">
          <h2 id={titleId} className="text-sm font-semibold text-gray-100">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1 text-gray-400 hover:bg-gray-800 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-gray-800 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
