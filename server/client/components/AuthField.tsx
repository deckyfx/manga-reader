import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";

interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Shown under the field: a rule that isn't met yet, or a hint. */
  note?: ReactNode;
  tone?: "hint" | "warn";
}

/** One labelled input on the sign-in screens, so the three of them look and behave alike. */
export const AuthField = forwardRef<HTMLInputElement, AuthFieldProps>(function AuthField(
  { label, note, tone = "hint", className = "", ...input },
  ref,
) {
  const generated = useId();
  // A caller may name the field (to point a label or a test at it); otherwise it gets one of its own
  const id = input.id ?? generated;
  const noteId = `${id}-note`;
  // A warning under the field is the reason the button is disabled: say so where a screen reader will hear it
  const invalid = note !== undefined && note !== null && tone === "warn";
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-gray-400">{label}</label>
      <input
        id={id}
        ref={ref}
        {...input}
        // After the spread: a caller's own description is kept, with the note's id added rather than replacing it
        aria-describedby={[input["aria-describedby"], note ? noteId : undefined].filter(Boolean).join(" ") || undefined}
        aria-invalid={input["aria-invalid"] ?? (invalid || undefined)}
        className={`w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 ${className}`}
      />
      {note && (
        <p id={noteId} className={`text-xs ${tone === "warn" ? "text-amber-400" : "text-gray-500"}`}>{note}</p>
      )}
    </div>
  );
});
