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
    return () => {
      set.delete(listener);
      if (set.size === 0 && this.listeners.get(pageId) === set) this.listeners.delete(pageId);
    };
  }

  /** Delivers the event to every subscriber of its page; returns how many were notified. */
  publish(event: PageLiveEvent): number {
    const set = this.listeners.get(event.page_id);
    for (const listener of set ?? []) listener(event);
    return set?.size ?? 0;
  }
}

export const pageLive = new PageLiveChannel();
