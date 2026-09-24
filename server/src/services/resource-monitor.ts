/**
 * What the machine is doing right now, for anyone watching.
 *
 * The same measurements the page log takes (see lib/resource-probe), read on a timer instead of around a piece of
 * work, so the Studio can show them while a page is being worked on. One sampler serves every watcher and stops
 * when the last one leaves: a server nobody is looking at does no work for this.
 */
import { gpuReadable, sampleMachine } from "@/lib/resource-probe";
import { currentWork } from "@/queue/page-queue";

/** How often watchers hear from the server. A second is plenty to watch a stage by, and costs nothing. */
const TICK_MS = 1000;

export interface ResourceSample {
  /** When it was taken (epoch ms), so a watcher can space its graph by real time rather than by arrival. */
  at: number;
  /** Share of one core since the last sample: 100 is a core, `cores * 100` is the machine. */
  cpu: number;
  cores: number;
  /** Resident memory of this server, in bytes. */
  rss: number;
  /** 0-100, or null where no GPU can be read. */
  gpu: number | null;
  vramUsed: number | null;
  vramTotal: number | null;
  /** What the page queue is working on, or null when it is idle. */
  work: string | null;
}

type Watcher = (sample: ResourceSample) => void;

const watchers = new Set<Watcher>();
let timer: ReturnType<typeof setInterval> | null = null;

/** Reads the machine now. Exported so a watcher can be told where things stand before the first tick. */
export function sampleResources(): ResourceSample {
  const machine = sampleMachine();
  return {
    at: Date.now(),
    cpu: machine.cpu,
    cores: machine.cores,
    rss: machine.rss,
    gpu: machine.gpu,
    vramUsed: machine.vramUsed,
    vramTotal: machine.vramTotal,
    work: currentWork(),
  };
}

/** Whether this machine can say how busy its GPU is; a watcher shows "not available" rather than an idle GPU. */
export const gpuAvailable = gpuReadable;

/** Sends a sample a second for as long as the returned function hasn't been called. */
export function watchResources(watcher: Watcher): () => void {
  watchers.add(watcher);
  timer ??= setInterval(() => {
    const sample = sampleResources();
    for (const each of watchers) each(sample);
  }, TICK_MS);
  timer.unref?.();
  return () => {
    watchers.delete(watcher);
    if (watchers.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
