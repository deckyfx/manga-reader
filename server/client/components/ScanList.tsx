import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import { listScans, type RegionScan } from "../api";
import { ListError } from "./ListError";
import { when } from "../lib/format";
import { fieldClass } from "../lib/styles";

const PAGE_SIZE = 50;

/** How the scan ran: through a tool's key, or from a signed-in browser. */
function Origin({ scan }: { scan: RegionScan }) {
  return (
    <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[11px] text-gray-400">
      {scan.via_key ? "key" : "browser"}
    </span>
  );
}

/**
 * The region scans the extension and the desktop app sent here: who ran each one, and what came back.
 * `userId` pins the list to one account; without it an admin sees everyone.
 */
export function ScanList({ userId, showWho }: { userId?: number; showWho?: boolean }) {
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");

  const scansQ = useInfiniteQuery({
    queryKey: ["scans", userId ?? "all", search],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => listScans({
      ...(userId !== undefined ? { user: userId } : {}),
      ...(search ? { q: search } : {}),
      ...(pageParam !== undefined ? { beforeId: pageParam } : {}),
      limit: PAGE_SIZE,
    }),
    // A short page is the end of the list; otherwise carry on below the last row
    getNextPageParam: (last) => (last.length < PAGE_SIZE ? undefined : last[last.length - 1]?.id),
  });

  const scans = scansQ.data?.pages.flat() ?? [];

  return (
    <div>
      <form
        className="mb-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(term.trim());
        }}
      >
        <div className="relative min-w-52 flex-1 md:max-w-sm">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-gray-500" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search the text or its translation"
            aria-label="Search scans"
            className={`${fieldClass} w-full pl-8`}
          />
          {term && (
            <button
              type="button"
              onClick={() => {
                setTerm("");
                setSearch("");
              }}
              aria-label="Clear the search"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-gray-500 hover:text-gray-50"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <button type="submit" className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700">Search</button>
        {scansQ.isFetching && <Loader2 size={14} className="animate-spin text-gray-500" />}
      </form>

      {scansQ.isError ? (
        <ListError error={scansQ.error} onRetry={() => void scansQ.refetch()} />
      ) : scansQ.isLoading ? (
        <Loader2 size={16} className="animate-spin text-gray-500" />
      ) : scans.length === 0 ? (
        <p className="text-sm text-gray-500">
          {search ? "No scan matches that." : "No scans yet. They appear here as the extension or the desktop app sends them."}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-900 text-left text-xs text-gray-400">
                <tr>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">When</th>
                  {showWho && <th className="px-3 py-2 font-medium">Who</th>}
                  <th className="px-3 py-2 font-medium">Text</th>
                  <th className="px-3 py-2 font-medium">Translation</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Engine</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Took</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800 bg-gray-950">
                {scans.map((scan) => (
                  <tr key={scan.id} className="align-top">
                    <td className="px-3 py-2 text-xs whitespace-nowrap text-gray-500">{when(scan.created_at)}</td>
                    {showWho && (
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="text-gray-300">{scan.username}</span> <Origin scan={scan} />
                      </td>
                    )}
                    <td className="max-w-md px-3 py-2 text-gray-200">{scan.source_text || <span className="text-gray-600">nothing read</span>}</td>
                    <td className="max-w-md px-3 py-2 text-gray-400">{scan.translated_text ?? <span className="text-gray-600">—</span>}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap text-gray-500">{scan.translate_engine}</td>
                    <td className="px-3 py-2 text-right text-xs whitespace-nowrap text-gray-500">{scan.elapsed_ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {scansQ.hasNextPage && (
            <button
              onClick={() => void scansQ.fetchNextPage()}
              disabled={scansQ.isFetchingNextPage}
              className="mt-3 rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
            >
              {scansQ.isFetchingNextPage ? <Loader2 size={14} className="animate-spin" /> : "Show older"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
