import { CheckCircle2, XCircle } from "lucide-react";

/** Ready, not ready, or switched off in the server's configuration. */
export function ReadyIcon({ ready }: { ready: boolean | "disabled" }) {
  if (ready === "disabled") return <span className="text-xs text-gray-600">disabled</span>;
  return ready
    ? <CheckCircle2 size={14} className="text-emerald-400" />
    : <XCircle size={14} className="text-red-400" />;
}
