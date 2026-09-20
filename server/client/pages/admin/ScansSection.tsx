import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getServerPolicy, updateServerPolicy } from "../../api";
import { ScanList } from "../../components/ScanList";
import { fieldClass } from "../../lib/styles";

/** A year is the most the server accepts; it matches MAX_SCAN_LOG_DAYS. */
const MAX_DAYS = 365;

/** Everyone's scans, and how long they're kept. */
export function ScansSection() {
  return (
    <div className="space-y-4">
      <RetentionControl />
      <ScanList showWho />
    </div>
  );
}

function RetentionControl() {
  const qc = useQueryClient();
  const policyQ = useQuery({ queryKey: ["server-policy"], queryFn: getServerPolicy });
  const [days, setDays] = useState<string | null>(null);
  const saveM = useMutation({
    mutationFn: (value: number) => updateServerPolicy({ scan_log_days: value }),
    onSuccess: (policy) => {
      qc.setQueryData(["server-policy"], policy);
      setDays(null);
      // Yesterday's rows may have just become too old to show
      void qc.invalidateQueries({ queryKey: ["scans"] });
    },
  });

  const stored = policyQ.data?.scan_log_days;
  const value = days ?? (stored === undefined ? "" : String(stored));
  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_DAYS;

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-800 bg-gray-950 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && parsed !== stored) saveM.mutate(parsed);
      }}
    >
      <label className="space-y-1">
        <span className="text-xs text-gray-400">Keep scans for (days, 0 keeps them for ever)</span>
        <input
          type="number"
          min={0}
          max={MAX_DAYS}
          value={value}
          onChange={(e) => setDays(e.target.value)}
          disabled={policyQ.isLoading || policyQ.isError}
          className={`${fieldClass} block w-44`}
        />
      </label>
      <button
        type="submit"
        disabled={!valid || parsed === stored || saveM.isPending}
        className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
      >
        {saveM.isPending ? <Loader2 size={14} className="animate-spin" /> : "Save"}
      </button>
      <p className="text-xs text-gray-500">Older scans go in the nightly sweep, and once when the server starts.</p>
      {policyQ.isError && <p className="w-full text-sm text-red-400">This setting couldn't be read: {policyQ.error.message}</p>}
      {saveM.error && <p className="w-full text-sm text-red-400">{saveM.error.message}</p>}
    </form>
  );
}
