import type { ReactNode } from "react";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The label, shown after the switch; clicking it toggles too. */
  children?: ReactNode;
  disabled?: boolean;
  title?: string;
  /** `sm` for dense toolbars and block rows, `md` (default) for forms and settings. */
  size?: "sm" | "md";
  /** Layout and text classes for the whole label (gap, text size, colour, margins). */
  className?: string;
}

const TRACK = { sm: "h-4 w-7", md: "h-5 w-9" } as const;
const KNOB = { sm: "h-3 w-3", md: "h-4 w-4" } as const;
const TRAVEL = { sm: "translate-x-3", md: "translate-x-4" } as const;

/**
 * An on/off switch in place of a checkbox. A real checkbox is still underneath, visually hidden but announced as a
 * switch, so the keyboard (Space), screen readers, clicking the label and the app's cursor rules all work as before.
 *
 * The off track is gray-600 and the knob is white in both themes: gray-600 is mid-grey on the dark theme and on the
 * inverted day theme alike, so the white knob stands out on either, and on the indigo of "on".
 */
export function Toggle({ checked, onChange, children, disabled = false, title, size = "md", className = "" }: ToggleProps) {
  return (
    <label className={`inline-flex items-center gap-2 ${disabled ? "opacity-50" : ""} ${className}`} title={title}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-gray-950 ${TRACK[size]} ${checked ? "bg-indigo-600" : "bg-gray-600"}`}
      >
        <span className={`rounded-full bg-white shadow transition-transform ${KNOB[size]} ${checked ? TRAVEL[size] : "translate-x-0"}`} />
      </span>
      {children}
    </label>
  );
}
