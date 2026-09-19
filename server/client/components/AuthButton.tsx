import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface AuthButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pending?: boolean;
  icon?: ReactNode;
  variant?: "primary" | "quiet";
}

/** The button the sign-in screens submit with; full width, with the spinner in place of its icon. */
export function AuthButton({ pending = false, icon, variant = "primary", children, className = "", ...button }: AuthButtonProps) {
  const tone = variant === "primary"
    ? "bg-indigo-600 text-white hover:bg-indigo-500"
    : "bg-gray-800 text-gray-100 hover:bg-gray-700";
  return (
    <button
      {...button}
      disabled={button.disabled || pending}
      className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${tone} ${className}`}
    >
      {pending ? <Loader2 size={15} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}
