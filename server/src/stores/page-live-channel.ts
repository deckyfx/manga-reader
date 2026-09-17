import { childLogger } from "@/lib/logger";

const log = childLogger("page-live");

/** Pushed to extension tabs that still show a translated page. */
export type PageLiveEvent =
  /** The page was edited and published in the Studio: reload the image from `result_url`. */
  { type: "page-updated"; page_id: string; revision: number; result_url: string };

type Listener = (event: PageLiveEvent) => void;

/** Per-page publish/subscribe for live updates; nothing is retained for tabs that connect later. */
class PageLiveChannel {
  private readonly listeners = new Map<string, Set<Listener>>();

  /** Returns an unsubscribe function. */
  subscribe(pageId: string, listener: Listener): () => void {
    const set = this.listeners.get(pageId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(pageId, set);
    return () => this.remove(pageId, listener);
  }

  /**
   * Delivers the event to every subscriber of its page and returns how many received it. A listener that throws
   * is dropped and doesn't stop the others; iterating a snapshot keeps unsubscribes during delivery safe.
   */
  publish(event: PageLiveEvent): number {
    const set = this.listeners.get(event.page_id);
    if (!set) return 0;
    let delivered = 0;
    for (const listener of [...set]) {
      try {
        listener(event);
        delivered++;
      } catch (err) {
        log.warn({ err, pageId: event.page_id }, "Live listener failed; removing it");
        this.remove(event.page_id, listener);
      }
    }
    return delivered;
  }

  private remove(pageId: string, listener: Listener): void {
    const set = this.listeners.get(pageId);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) this.listeners.delete(pageId);
  }
}

export const pageLive = new PageLiveChannel();
