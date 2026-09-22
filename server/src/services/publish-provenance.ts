/**
 * The one-time handover from guessed to recorded publish state.
 *
 * "Has this page got work readers can't see yet" used to be inferred by comparing result.png's modification time with
 * the newest published snapshot's. It is recorded now (`pages.resultSeq` / `pages.publishedSeq`), but a library that
 * existed before has every page at `publishedSeq = null`, which reads as "all of it unpublished". This pass reads the
 * old answer once, for every page, and records it — so nothing that was published starts showing as edited, and
 * nothing that had edits loses them.
 *
 * The old file-time rule lives here and nowhere else, and only runs this once per server.
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { childLogger } from "@/lib/logger";
import { publishedFile } from "@/services/page-history";
import { pageDir, PageStore } from "@/stores/page-store";
import { ServerSettingStore } from "@/stores/settings-store";

const log = childLogger("publish-provenance");

/** When the handover ran; it must happen once, before any publish has recorded state of its own. */
const ADOPTED_AT_KEY = "publish_provenance_adopted_at";

/**
 * The old rule: `resultPageId`'s result is newer than what `publishedPageId` last published. A draft of a chapter page
 * is measured against that page, since publishing a draft publishes over it.
 */
function legacyHasEdits(resultPageId: string, publishedPageId: string): boolean {
  const result = join(pageDir(resultPageId), "result.png");
  if (!existsSync(result)) return false;
  const published = publishedFile(publishedPageId);
  if (!published) return true;
  try {
    return statSync(result).mtimeMs > statSync(published).mtimeMs;
  } catch {
    // Unreadable either way: count it as edited, which offers a publish rather than hiding work
    return true;
  }
}

/**
 * Records, for every page whose publish state was never recorded, what the old rule said: published pages get their
 * current result marked as published, the rest stay unpublished. Returns how many were marked.
 */
export async function adoptLegacyProvenance(): Promise<number> {
  let marked = 0;
  for (const page of await PageStore.listUnrecordedPublishState()) {
    if (!existsSync(join(pageDir(page.id), "result.png"))) continue;
    if (legacyHasEdits(page.id, page.originPageId ?? page.id)) continue;
    await PageStore.markResultPublished(page.id);
    marked++;
  }
  return marked;
}

/** Runs the handover once per server; null when it already has. */
export async function adoptLegacyProvenanceOnce(): Promise<number | null> {
  if ((await ServerSettingStore.get(ADOPTED_AT_KEY)) !== undefined) return null;
  // Stamped after the pass: one that threw has not happened, and must run again next start
  const marked = await adoptLegacyProvenance();
  await ServerSettingStore.set(ADOPTED_AT_KEY, new Date().toISOString());
  log.info({ marked }, "Recorded the publish state of existing pages");
  return marked;
}
