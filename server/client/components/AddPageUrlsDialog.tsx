import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link2, Loader2 } from "lucide-react";
import { Modal } from "./Modal";

const MAX_URLS = 50;

/**
 * One address per line: blanks ignored, anything that isn't http(s) rejected, and an address given twice kept once.
 * A list pasted out of a reader often repeats one, and each repeat would otherwise become its own page.
 */
export function splitUrls(text: string): { urls: string[]; rejected: string[]; duplicates: number } {
  const urls: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const line of text.split(/\r?\n/)) {
    const url = line.trim();
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        rejected.push(url);
        continue;
      }
    } catch {
      rejected.push(url);
      continue;
    }
    if (seen.has(url)) {
      duplicates++;
      continue;
    }
    seen.add(url);
    urls.push(url);
  }
  return { urls, rejected, duplicates };
}

/**
 * Pasting a list of image addresses. The server downloads them in the order given, so the order pasted is the
 * reading order — and an address that fails comes back as a skipped entry rather than failing the lot.
 */
export function AddPageUrlsDialog({
  title,
  onClose,
  onImport,
  resendable = false,
}: {
  title: string;
  onClose: () => void;
  /** Runs the import; answers with what was filed and what wasn't, and which address each failure was. */
  onImport: (urls: string[]) => Promise<{ imported: number; skipped: { url: string | null; name: string; reason: string }[] }>;
  /**
   * Whether sending the same list again is harmless. A workspace holds each page at a position, so a second attempt
   * fills the gaps and leaves the rest alone; a chapter appends whatever it is given, so resending would file every
   * address that worked a second time.
   */
  resendable?: boolean;
}) {
  const [text, setText] = useState("");
  /** The list a result came back for, so the same one can't be sent twice. */
  const [imported, setImported] = useState<string | null>(null);
  const { urls, rejected, duplicates } = splitUrls(text);
  const tooMany = urls.length > MAX_URLS;

  const importM = useMutation({
    mutationFn: () => onImport(urls),
    onSuccess: (report) => {
      setImported(text);
      if (report.skipped.length === 0) onClose();
    },
  });
  const report = importM.data;
  /**
   * Sending the same list again would file every address that worked a second time: a chapter appends what it is
   * given, so a partial import followed by a retry duplicates the pages that succeeded. Editing the list — or
   * pressing "Retry the failures", which cuts it down to those — is what makes the button live again.
   */
  const alreadySent = !resendable && imported !== null && text === imported;
  /**
   * The addresses that failed, as addresses rather than as names. A name is derived from the path, so two addresses
   * can share one and an extensionless address is filed under a name that doesn't look like it — matching on names
   * would offer to resend an address that worked.
   */
  const failedUrls = report?.skipped.map((entry) => entry.url).filter((url): url is string => url !== null) ?? [];

  return (
    <Modal
      title={title}
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          {importM.error && <span className="mr-auto self-center text-xs text-red-400">{importM.error.message}</span>}
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800">
            {report ? "Close" : "Cancel"}
          </button>
          <button
            onClick={() => importM.mutate()}
            disabled={urls.length === 0 || tooMany || alreadySent || importM.isPending}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {importM.isPending && <Loader2 size={14} className="animate-spin" />}
            {urls.length > 0 ? `Download ${urls.length} page${urls.length === 1 ? "" : "s"}` : "Download"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block space-y-1">
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            <Link2 size={12} />
            One image address per line, in reading order
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            autoFocus
            placeholder={"https://host.example/chapter/001.png\nhttps://host.example/chapter/002.png"}
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-xs text-gray-100 focus:border-indigo-500 focus:outline-none"
          />
        </label>

        {tooMany && (
          <p className="text-xs text-amber-400">
            {urls.length} addresses — {MAX_URLS} at a time is the limit. Split the list.
          </p>
        )}
        {duplicates > 0 && (
          <p className="text-xs text-gray-500">
            {duplicates} repeated address{duplicates === 1 ? "" : "es"} will be downloaded once.
          </p>
        )}
        {rejected.length > 0 && (
          <p className="text-xs text-amber-400">
            Ignored {rejected.length} line{rejected.length === 1 ? "" : "s"} that {rejected.length === 1 ? "isn't" : "aren't"} a
            web address: {rejected.slice(0, 3).map((line) => line.slice(0, 40)).join(", ")}
            {rejected.length > 3 ? "…" : ""}
          </p>
        )}
        {importM.isPending && (
          <p className="text-xs text-gray-500">Downloading one at a time, so the host isn't hammered — this can take a moment.</p>
        )}

        {report && (
          <div className="space-y-1 rounded-lg border border-gray-800 bg-gray-950 p-3 text-xs">
            <p className="text-gray-200">
              Filed {report.imported} page{report.imported === 1 ? "" : "s"}.
            </p>
            {report.skipped.length > 0 && (
              <>
                <ul className="space-y-0.5 text-amber-400">
                  {report.skipped.map((entry, i) => (
                    <li key={`${entry.name}-${i}`}>{entry.name}: {entry.reason}</li>
                  ))}
                </ul>
                {failedUrls.length > 0 && !resendable && (
                  <button
                    type="button"
                    onClick={() => setText(failedUrls.join("\n"))}
                    className="mt-1 rounded-lg bg-gray-800 px-2.5 py-1 text-xs text-gray-200 hover:bg-gray-700"
                  >
                    Retry the {failedUrls.length} that failed
                  </button>
                )}
                <p className="text-gray-500">
                  {resendable
                    ? "Sending the same list again fills the gaps: the pages already here keep their places."
                    : "The ones that worked are filed already — edit the list before sending it again, or they'd be filed twice."}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
