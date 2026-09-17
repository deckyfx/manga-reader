/** One undoable canvas change; both directions call the server. */
export interface Command {
  label: string;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

/**
 * Undo / redo stack of server-backed commands. Recreating a deleted region gives it a new block id, so commands
 * record ids through `resolve`, which follows the aliases added whenever a region comes back under a new id.
 */
export class CommandHistory {
  private past: Command[] = [];
  private future: Command[] = [];
  private readonly aliases = new Map<number, number>();

  constructor(
    private readonly onChange: () => void,
    private readonly limit = 100,
  ) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Label of the change the next undo reverts, for tooltips. */
  get undoLabel(): string | undefined {
    return this.past.at(-1)?.label;
  }

  get redoLabel(): string | undefined {
    return this.future.at(-1)?.label;
  }

  /** The block's current id, following recreations. */
  resolve(id: number): number {
    const seen = new Set<number>();
    let current = id;
    while (this.aliases.has(current) && !seen.has(current)) {
      seen.add(current);
      current = this.aliases.get(current) ?? current;
    }
    return current;
  }

  /** Records that the block known as `from` now has id `to`. */
  alias(from: number, to: number): void {
    if (from !== to) this.aliases.set(from, to);
  }

  /** Adds a change that has already been applied; clears the redo stack. */
  push(command: Command): void {
    this.past.push(command);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.onChange();
  }

  /** Reverts the latest change. On failure the history is cleared, since it no longer matches the server. */
  async undo(): Promise<void> {
    const command = this.past.pop();
    if (!command) return;
    try {
      await command.undo();
      this.future.push(command);
    } catch (err) {
      this.clear();
      throw err;
    } finally {
      this.onChange();
    }
  }

  /** Re-applies the latest undone change. On failure the history is cleared. */
  async redo(): Promise<void> {
    const command = this.future.pop();
    if (!command) return;
    try {
      await command.redo();
      this.past.push(command);
    } catch (err) {
      this.clear();
      throw err;
    } finally {
      this.onChange();
    }
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.aliases.clear();
    this.onChange();
  }
}
