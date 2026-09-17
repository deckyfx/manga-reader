import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, Loader2 } from "lucide-react";

/** One entry of an {@link ActionsMenu}. */
export interface MenuAction {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  /** Why the action can't run right now; the item is disabled and shows this instead of its hint. */
  unavailable?: string;
  /** Short secondary line (e.g. what the action does). */
  hint?: string;
  /** Running: shows a spinner instead of the icon. */
  pending?: boolean;
  /** Its stage is out of date: highlighted, and the menu button shows a dot. */
  attention?: boolean;
  /** Destructive: drawn in red. */
  danger?: boolean;
  /** Draws a divider above the item. */
  separated?: boolean;
}

/**
 * A compact "Actions" dropdown for a toolbar: keeps the bar short while each action still shows whether it's out of
 * date, running or unavailable (and why). Keyboard: Enter / Space / ↓ open it, ↑ ↓ Home End move, Escape closes.
 */
export function ActionsMenu({ actions, label = "Actions" }: { actions: MenuAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const menuId = useId();

  const attention = actions.some((a) => a.attention && !a.unavailable);
  const pending = actions.some((a) => a.pending);
  const enabled = actions.filter((a) => !a.unavailable);

  const focusItem = (index: number) => {
    const target = enabled[(index + enabled.length) % enabled.length];
    if (target) itemRefs.current.get(target.key)?.focus();
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  // Focus the first available item when the menu opens
  useEffect(() => {
    if (open) focusItem(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A press anywhere outside closes the menu
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" && !open) {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = enabled.findIndex((a) => itemRefs.current.get(a.key) === document.activeElement);
    if (e.key === "ArrowDown") focusItem(current + 1);
    else if (e.key === "ArrowUp") focusItem(current < 0 ? -1 : current - 1);
    else if (e.key === "Home") focusItem(0);
    else if (e.key === "End") focusItem(-1);
    else if (e.key === "Escape") close(true);
    else if (e.key === "Tab") close(false);
    else return;
    if (e.key !== "Tab") e.preventDefault();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={attention ? "Some stages are out of date" : undefined}
        className="relative flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-800 hover:bg-gray-700 transition-colors"
      >
        {pending && <Loader2 size={14} className="animate-spin" />}
        {label}
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        {attention && <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-gray-950" aria-hidden />}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full mt-1 z-30 w-64 max-w-[calc(100vw-2rem)] py-1 rounded-lg border border-gray-700 bg-gray-900 shadow-xl"
        >
          {actions.map((action) => {
            const disabled = !!action.unavailable;
            const secondary = action.unavailable ?? (action.attention ? "Out of date" : action.hint);
            return (
              <div key={action.key}>
                {action.separated && <div className="my-1 border-t border-gray-800" role="separator" />}
                <button
                  ref={(el) => {
                    if (el) itemRefs.current.set(action.key, el);
                    else itemRefs.current.delete(action.key);
                  }}
                  role="menuitem"
                  disabled={disabled}
                  onClick={() => {
                    close(true);
                    action.onSelect();
                  }}
                  className={`w-full flex items-start gap-2.5 px-3 py-2 text-left text-sm outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                    action.danger ? "text-red-300 hover:bg-red-900/40 focus:bg-red-900/40" : "text-gray-200 hover:bg-gray-800 focus:bg-gray-800"
                  }`}
                >
                  <span className={`mt-0.5 shrink-0 ${action.attention && !disabled ? "text-amber-400" : ""}`}>
                    {action.pending ? <Loader2 size={14} className="animate-spin" /> : action.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      {action.label}
                      {action.attention && !disabled && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />}
                    </span>
                    {secondary && (
                      <span className={`block text-xs ${action.attention && !disabled ? "text-amber-400/90" : "text-gray-500"}`}>{secondary}</span>
                    )}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
