/**
 * Edits that wait a moment before they are saved, because a number field reports every keystroke: typing "24"
 * reports 2, then 24, and only the second is meant.
 *
 * Kept out of the component so its three promises can be tested without one: edits made close together go out as
 * one save; nothing waiting is lost when the screen goes away (a flush sends it, to the page it was typed on); and
 * nothing waiting can land after a reset and quietly undo part of it.
 */
export class PendingChanges<T extends object> {
  private pending: Partial<T> = {};
  private timer: ReturnType<typeof setTimeout> | undefined;
  private target: string | null = null;

  /**
   * @param send   saves `changes` for the page `id`
   * @param delay  how long an edit waits for the next one, in milliseconds
   */
  constructor(
    private readonly send: (id: string, changes: Partial<T>) => void,
    private readonly delay: number,
  ) {}

  /**
   * Records an edit to page `id`, and (re)starts the wait. An edit for another page first sends what was waiting
   * for the one before, so no save ever carries one page's edits to another.
   */
  change<K extends keyof T>(id: string, key: K, value: T[K]): void {
    if (this.target !== null && this.target !== id) this.flush();
    this.target = id;
    this.pending = { ...this.pending, [key]: value };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  /** Sends whatever is waiting, now. Does nothing when nothing is. */
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const changes = this.pending;
    const id = this.target;
    this.pending = {};
    this.target = null;
    if (id !== null && Object.keys(changes).length > 0) this.send(id, changes);
  }

  /** Forgets whatever is waiting, unsent — for a reset, which replaces it. */
  discard(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = {};
    this.target = null;
  }
}
