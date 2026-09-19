import { CloudOff, RotateCcw } from "lucide-react";

/**
 * Shown when the server couldn't be asked something — not when it answered "no". A page that guards itself uses
 * this instead of redirecting, so a dropped connection doesn't look like being signed out.
 */
export function LoadFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="max-w-sm space-y-3 text-center">
        <CloudOff size={28} className="mx-auto text-gray-600" />
        <p className="text-sm text-gray-300">The server couldn't be reached.</p>
        <p className="text-xs text-gray-500">{message}</p>
        <button
          onClick={onRetry}
          className="mx-auto flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-100 hover:bg-gray-700"
        >
          <RotateCcw size={14} /> Try again
        </button>
      </div>
    </div>
  );
}
