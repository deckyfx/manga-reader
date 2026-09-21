import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { getWorkspace, listInbox, StudioPageSummary, StudioWorkspace } from "../api";

type WorkspaceDetail = Awaited<ReturnType<typeof getWorkspace>>;
type InboxPage = Awaited<ReturnType<typeof listInbox>>[number];

/** Puts back every cache entry a removal touched, for when the server refuses it. */
export type Restore = () => void;

/** Applies `edit` to every cached query under `key`, remembering what each held. */
function editQueries<T>(qc: QueryClient, key: QueryKey, edit: (data: T) => T): [QueryKey, T | undefined][] {
  const before = qc.getQueriesData<T>({ queryKey: key });
  for (const [queryKey, data] of before) if (data !== undefined) qc.setQueryData<T>(queryKey, edit(data));
  return before;
}

function restorer(qc: QueryClient, snapshots: [QueryKey, unknown][]): Restore {
  return () => {
    for (const [queryKey, data] of snapshots) qc.setQueryData(queryKey, data);
  };
}

/**
 * Takes a page out of every list showing it right away — the Studio lists, workspace pages, the Inbox — instead of
 * leaving it there until those lists are fetched again. Returns how to put it back.
 */
export function forgetPage(qc: QueryClient, pageId: string): Restore {
  return restorer(qc, [
    ...editQueries<StudioPageSummary[]>(qc, ["studio-pages"], (pages) => pages.filter((page) => page.id !== pageId)),
    ...editQueries<InboxPage[]>(qc, ["inbox"], (pages) => pages.filter((page) => page.id !== pageId)),
    ...editQueries<WorkspaceDetail>(qc, ["workspace"], (detail) =>
      detail.pages.some((page) => page.id === pageId)
        ? { ...detail, pages: detail.pages.filter((page) => page.id !== pageId), workspace: { ...detail.workspace, pages: detail.workspace.pages - 1 } }
        : detail),
  ]);
}

/** Takes a workspace off the Studio's list right away; its own page is left, since the caller navigates off it. */
export function forgetWorkspace(qc: QueryClient, workspaceId: number): Restore {
  return restorer(qc, editQueries<StudioWorkspace[]>(qc, ["workspaces"], (workspaces) => workspaces.filter((entry) => entry.id !== workspaceId)));
}
