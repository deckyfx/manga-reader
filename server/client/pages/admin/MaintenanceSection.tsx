import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { publishBackfillPending, runPublishBackfill } from "../../api";
import { Card } from "../../components/Card";
import { when } from "../../lib/format";

/** Jobs an admin runs by hand, when something in the library needs putting right. */
export function MaintenanceSection() {
  return (
    <div className="space-y-5">
      <PublishBackfillCard />
    </div>
  );
}

function PublishBackfillCard() {
  const qc = useQueryClient();
  const pendingQ = useQuery({ queryKey: ["publish-backfill"], queryFn: publishBackfillPending });
  const runM = useMutation({
    mutationFn: runPublishBackfill,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["publish-backfill"] });
      void qc.invalidateQueries({ queryKey: ["series"] });
    },
  });

  const pending = pendingQ.data?.pending;
  const blocked = pendingQ.data?.blocked ?? [];
  const ranAt = pendingQ.data?.ran_at ?? null;
  const failed = runM.data?.failed ?? [];

  return (
    <Card
      title="Publish pages burnt before the publish gate"
      description="Readers are only ever served published pages. The server did this once, on the first start after the upgrade. Running it again publishes every chapter page that holds a finished result nobody has published — including work somebody may be holding back, so press it deliberately."
    >
      {pendingQ.isError ? (
        <p className="text-sm text-red-400">This couldn't be checked: {pendingQ.error.message}</p>
      ) : pendingQ.isLoading ? (
        <Loader2 size={16} className="animate-spin text-gray-500" />
      ) : pending === 0 ? (
        <p className="flex items-center gap-2 text-sm text-gray-400">
          <CheckCircle2 size={15} className="text-emerald-400" />
          No page is waiting to be published.
        </p>
      ) : (
        <p className="text-sm text-gray-300">
          {pending} page{pending === 1 ? "" : "s"} hold a finished result nobody has published.
        </p>
      )}

      {ranAt && <p className="mt-1 text-xs text-gray-500">The one-time pass ran {when(ranAt)}.</p>}

      {blocked.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3">
          <p className="text-sm text-amber-200">
            {blocked.length} page{blocked.length === 1 ? "" : "s"} can't be published as they stand, so readers are served their
            originals:
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-gray-400">
            {blocked.map((entry) => (
              <li key={entry.pageId}>
                <code className="text-gray-500">{entry.pageId.slice(-8)}</code> — {entry.reason}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-gray-500">Re-render them in the Studio, then publish from there.</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => runM.mutate()}
          disabled={runM.isPending || pendingQ.isLoading || pending === 0}
          className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          {runM.isPending ? <Loader2 size={14} className="animate-spin" /> : "Publish them"}
        </button>
        <p className="text-xs text-gray-500">
          Here for the pages that failed the one-time pass, or that have become publishable since.
        </p>
      </div>

      {runM.isSuccess && (
        <p className="mt-3 text-sm text-emerald-400">
          Published {runM.data.published} page{runM.data.published === 1 ? "" : "s"}.
        </p>
      )}
      {failed.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/20 p-3">
          <p className="text-sm text-red-300">{failed.length} page{failed.length === 1 ? "" : "s"} couldn't be published:</p>
          <ul className="mt-1 space-y-0.5 text-xs text-gray-400">
            {failed.map((entry) => (
              <li key={entry.pageId}>
                <code className="text-gray-500">{entry.pageId.slice(-8)}</code> — {entry.error}
              </li>
            ))}
          </ul>
        </div>
      )}
      {runM.error && <p className="mt-3 text-sm text-red-400">{runM.error.message}</p>}
    </Card>
  );
}
