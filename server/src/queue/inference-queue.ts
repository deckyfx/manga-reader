/** Sequential inference queue — replaces C# Channel<InferenceJob> + InferenceWorker. */

export type InferenceJobType = "ocr" | "translate" | "text-seg" | "bubble" | "inpaint";

export interface InferenceJob<TInput = unknown, TOutput = unknown> {
  type: InferenceJobType;
  input: TInput;
  resolve: (result: TOutput) => void;
  reject: (err: Error) => void;
  /** Aborted when the per-job timeout fires; handlers should poll this in loops. */
  signal: AbortSignal;
  /** Timestamp (ms) when the job was enqueued — used to detect deadline expiry before dispatch. */
  enqueuedAt: number;
}

const MAX_QUEUE_DEPTH = 50;
const JOB_TIMEOUT_MS = 120_000; // 2 minutes per inference job

class InferenceQueue {
  private static instance: InferenceQueue;
  private queue: InferenceJob[] = [];
  private processing = false;

  static getInstance(): InferenceQueue {
    if (!InferenceQueue.instance) InferenceQueue.instance = new InferenceQueue();
    return InferenceQueue.instance;
  }

  enqueue<TInput, TOutput>(type: InferenceJobType, input: TInput): Promise<TOutput> {
    if (this.queue.length >= MAX_QUEUE_DEPTH) {
      return Promise.reject(new Error("Inference queue is full; try again later"));
    }
    const controller = new AbortController();
    return new Promise<TOutput>((resolve, reject) => {
      this.queue.push({
        type,
        input,
        resolve: resolve as (r: unknown) => void,
        reject,
        signal: controller.signal,
        enqueuedAt: Date.now(),
      });
      // Store controller so drain can abort on timeout.
      (this.queue[this.queue.length - 1] as InferenceJob & { _controller: AbortController })._controller = controller;
      this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()! as InferenceJob & { _controller?: AbortController };
        const controller = job._controller;
        // Reject immediately if the deadline already expired while queued; otherwise
        // use the remaining budget so total wait + execution never exceeds JOB_TIMEOUT_MS.
        const remaining = JOB_TIMEOUT_MS - (Date.now() - job.enqueuedAt);
        if (remaining <= 0) {
          controller?.abort();
          job.reject(new Error(`Inference job timed out after ${JOB_TIMEOUT_MS}ms`));
          continue;
        }
        const dispatched = this.dispatch(job);
        let timerId: ReturnType<typeof setTimeout> | undefined;
        const timer = new Promise<never>((_, rej) => {
          timerId = setTimeout(() => {
            controller?.abort();
            rej(new Error(`Inference job timed out after ${JOB_TIMEOUT_MS}ms`));
          }, remaining);
        });
        try {
          const result = await Promise.race([dispatched, timer]);
          job.resolve(result);
        } catch (err) {
          job.reject(err instanceof Error ? err : new Error(String(err)));
          // Wait for dispatch to settle so the queue remains strictly sequential and
          // the timed-out handler can no longer access shared inference resources.
          await dispatched.catch(() => {});
        } finally {
          clearTimeout(timerId);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async dispatch(job: InferenceJob): Promise<unknown> {
    switch (job.type) {
      case "ocr":       return inferenceHandlers.ocr(job.input, job.signal);
      case "translate": return inferenceHandlers.translate(job.input, job.signal);
      case "text-seg":  return inferenceHandlers["text-seg"](job.input, job.signal);
      case "bubble":    return inferenceHandlers.bubble(job.input, job.signal);
      case "inpaint":   return inferenceHandlers.inpaint(job.input, job.signal);
      default:
        throw new Error(`Unknown inference job type: ${job.type}`);
    }
  }
}

/** Handlers are registered by each service at boot time. */
export const inferenceHandlers: Record<InferenceJobType, (input: unknown, signal: AbortSignal) => Promise<unknown>> = {
  ocr: async () => { throw new Error("OCR service not loaded"); },
  translate: async () => { throw new Error("Translate service not loaded"); },
  "text-seg": async () => { throw new Error("TextSeg service not loaded"); },
  bubble: async () => { throw new Error("Bubble service not loaded"); },
  inpaint: async () => { throw new Error("Inpaint service not loaded"); },
};

export const inferenceQueue = InferenceQueue.getInstance();
