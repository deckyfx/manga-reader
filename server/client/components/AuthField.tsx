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
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-gray-400">{label}</label>
      <input
        id={id}
        ref={ref}
        {...input}
        className={`w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 ${className}`}
      />
      {note && <p className={`text-xs ${tone === "warn" ? "text-amber-400" : "text-gray-500"}`}>{note}</p>}
    </div>
  );
});
