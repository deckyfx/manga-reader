import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut } from "lucide-react";
import { endAnySession, listAllSessions } from "../../api";
import { when } from "../../lib/format";

/** Every browser signed in to this server right now. */
export function SessionsSection() {
  const qc = useQueryClient();
  const sessionsQ = useQuery({ queryKey: ["admin-sessions"], queryFn: listAllSessions });
  const endM = useMutation({ mutationFn: (id: string) => endAnySession(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-sessions"] }) });
  const sessions = sessionsQ.data ?? [];

  return (
    <div>
      {sessionsQ.isError ? (
        <p className="text-sm text-red-400">The sessions couldn't be read: {sessionsQ.error.message}</p>
      ) : sessionsQ.isLoading ? (
        <Loader2 size={16} className="animate-spin text-gray-500" />
      ) : sessions.length === 0 ? (
        <p className="text-sm text-gray-500">Nobody is signed in.</p>
      ) : (
        <ul className="divide-y divide-gray-800 overflow-hidden rounded-lg border border-gray-800">
          {sessions.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center gap-2 bg-gray-950 px-3 py-2">
              <span className="text-sm">{session.username}</span>
              <span className="max-w-64 truncate text-xs text-gray-500" title={session.user_agent ?? undefined}>
                {session.user_agent ?? "unknown device"}
              </span>
              {session.current && <span className="rounded bg-emerald-900/60 px-1.5 py-0.5 text-[11px] text-emerald-300">this one</span>}
              <span className="ml-auto text-xs text-gray-500">last seen {when(session.last_seen_at)}</span>
              {!session.current && (
                <button
                  onClick={() => endM.mutate(session.id)}
                  disabled={endM.isPending}
                  aria-label={`Sign out ${session.username}`}
                  className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-red-300 disabled:opacity-40"
                >
                  <LogOut size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {endM.error && <p className="mt-2 text-sm text-red-400">{endM.error.message}</p>}
    </div>
  );
}
