import { type ReactNode } from "react";
import { Link } from "react-router";
import { ScanText } from "lucide-react";

interface AuthShellProps {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  /** Small print under the card: links to the other screens. */
  footer?: ReactNode;
}

/**
 * The frame the sign-in screens share. They render outside the app's Layout — there is nowhere to navigate to until
 * you are through them — so this carries the background, the centring and the one bit of identity the app has.
 */
export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-10">
      {/* A soft glow behind the card, so the screen isn't a flat expanse of near-black */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_50%_-10%,rgba(99,102,241,0.18),transparent_70%)]"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-800 bg-gray-900 text-indigo-400">
            <ScanText size={22} />
          </span>
          <Link to="/read" className="text-sm font-medium text-gray-400 hover:text-gray-200">Web OCR</Link>
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-900/80 p-6 shadow-xl shadow-black/40 backdrop-blur">
          <h1 className="text-lg font-semibold text-gray-100">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-gray-400">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>

        {footer && <div className="mt-4 text-center text-xs text-gray-500">{footer}</div>}
      </div>
    </div>
  );
}
