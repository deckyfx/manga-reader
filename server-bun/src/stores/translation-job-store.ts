/** Server-sent events for a page translation job, in the order they are emitted. */
export type PageJobEvent =
  /** A pipeline step started or finished — shown as a line in the client's log. */
  | { type: "log"; stage: string; message: string; progress: number }
  /** Progress inside a step (e.g. "Reading text 3/8") — updates the status without adding a log line. */
  | { type: "progress"; stage: string; message: string; progress: number }
  | { type: "done"; stage: "done"; message: string; progress: 1; result: string; result_url: string; elapsed_ms: number }
  | { type: "error"; stage: "error"; message: string; error: string };

export type PageJobStatus = "queued" | "running" | "done" | "error";

export interface TranslationJob {
  id: string;
  /** Requested clean_sfx option, so a concurrent request with different options isn't handed this job. */
  cleanSfx: boolean;
  status: PageJobStatus;
  stage: string;
  progress: number;
  error: string | null;
  events: PageJobEvent[];
  completedAt: number | null;
}

type Listener = (event: PageJobEvent) => void;

/** Finished jobs (and their base64 result) stay subscribable this long, then are dropped. */
const RETENTION_MS = 5 * 60 * 1000;

/** In-memory job registry: keeps each job's event history so late SSE subscribers get a full replay. */
class TranslationJobStore {
  private readonly jobs = new Map<string, TranslationJob>();
  private readonly listeners = new Map<string, Set<Listener>>();

  create(id: string, cleanSfx: boolean): TranslationJob {
    const job: TranslationJob = { id, cleanSfx, status: "queued", stage: "queued", progress: 0, error: null, events: [], completedAt: null };
    this.jobs.set(id, job);
    return job;
  }

  get(id: string): TranslationJob | undefined {
    return this.jobs.get(id);
  }

  emit(id: string, event: PageJobEvent): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.events.push(event);
    job.stage = event.stage;
    if (event.type === "done") {
      job.status = "done";
      job.progress = 1;
      job.completedAt = Date.now();
    } else if (event.type === "error") {
      job.status = "error";
      job.error = event.error;
      job.completedAt = Date.now();
    } else {
      job.status = event.stage === "queued" ? "queued" : "running";
      job.progress = event.progress;
    }
    for (const listener of this.listeners.get(id) ?? []) listener(event);
    if (job.completedAt !== null) {
      this.listeners.delete(id);
      // Drop the finished job (and its base64 result) unless the page was resubmitted meanwhile
      setTimeout(() => {
        if (this.jobs.get(id) === job) this.jobs.delete(id);
      }, RETENTION_MS).unref();
    }
  }

  /** Replays past events, then streams new ones until the job finishes. Returns an unsubscribe function. */
  subscribe(id: string, listener: Listener): () => void {
    const job = this.jobs.get(id);
    if (!job) return () => {};
    for (const event of job.events) listener(event);
    if (job.completedAt !== null) return () => {};
    const set = this.listeners.get(id) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(id, set);
    return () => set.delete(listener);
  }
}

export const translationJobs = new TranslationJobStore();
