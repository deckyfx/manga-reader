import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * A password field with a way to read it back.
 *
 * An admin setting somebody else's password has to be able to see what they are about to hand over, but a password
 * sitting in plain text through a screen share is its own problem — so it is hidden by default and revealed on ask.
 */
export function SecretInput({ className = "", ...input }: InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        {...input}
        type={shown ? "text" : "password"}
        autoComplete="new-password"
        className={`w-full rounded-lg border border-gray-700 bg-gray-950 py-1.5 pl-3 pr-9 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none ${className}`}
      />
      <button
        type="button"
        onClick={() => setShown((on) => !on)}
        title={shown ? "Hide" : "Show"}
        aria-label={shown ? "Hide the password" : "Show the password"}
        className="absolute inset-y-0 right-0 flex items-center px-2.5 text-gray-500 hover:text-gray-200"
      >
        {shown ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}
