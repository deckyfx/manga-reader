import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut } from "lucide-react";
import { endMySession, listMySessions } from "../../api";
import { ListError } from "../../components/ListError";
import { when } from "../../lib/format";

/** Every browser this account is signed in on. */
export function SessionSection() {
  const qc = useQueryClient();
  const listQ = useQuery({ queryKey: ["my-sessions"], queryFn: listMySessions });
  const endM = useMutation({ mutationFn: (id: string) => endMySession(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["my-sessions"] }) });
  const sessions = listQ.data ?? [];

  return (
    <div className="max-w-3xl">
      {listQ.isLoading ? (
        <Loader2 size={16} className="animate-spin text-gray-500" />
      ) : listQ.isError ? (
        <ListError error={listQ.error} onRetry={() => void listQ.refetch()} />
      ) : (
        <ul className="divide-y divide-gray-800 overflow-hidden rounded-lg border border-gray-800">
          {sessions.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center gap-2 bg-gray-950 px-3 py-2">
              <span className="max-w-72 truncate text-sm text-gray-300" title={session.user_agent ?? undefined}>
                {session.user_agent ?? "unknown device"}
              </span>
              {session.current && <span className="rounded bg-emerald-900/60 px-1.5 py-0.5 text-[11px] text-emerald-300">this one</span>}
              <span className="ml-auto text-xs text-gray-500">last seen {when(session.last_seen_at)}</span>
              {!session.current && (
                <button
                  onClick={() => endM.mutate(session.id)}
                  disabled={endM.isPending}
                  aria-label="Sign this session out"
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
