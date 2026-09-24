/**
 * How much of the machine a piece of work costs: processor, memory, and the GPU if it can be read.
 *
 * Sampled rather than asked for, because the numbers that matter here aren't in the JS runtime. The models are
 * native allocations inside onnxruntime and libvips — `heapStats()` reports a few hundred kilobytes while the
 * process holds gigabytes — so memory is taken as the process's resident set, and processor time from the whole
 * process. That is fair to a stage because the pipeline's heavy work runs under `runExclusiveResult`: while a
 * stage is measured, nothing else in this server is competing with it.
 *
 * The GPU is read from sysfs (amdgpu exposes `gpu_busy_percent`), which needs no tool and no permissions. Where
 * there is nothing to read — another vendor, a container without sysfs — it reports null rather than zero, because
 * "idle" and "can't tell" are different answers.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";

/** How often the machine is looked at while work runs. Short enough to catch a spike, far too cheap to matter. */
const SAMPLE_MS = 250;

/** What one piece of work cost. Percentages are of a single core, so 100 is one core and `cores * 100` is the lot. */
export interface Usage {
  wallMs: number;
  /** Processor time this process used during the work, in milliseconds. */
  cpuMs: number;
  cpuAvg: number;
  cpuPeak: number;
  /** Resident memory in bytes: the whole process, models included. */
  rssAvg: number;
  rssPeak: number;
  /** 0–100, or null where no GPU could be read. */
  gpuAvg: number | null;
  gpuPeak: number | null;
  /** Video memory in use at its highest during the work, in bytes; null when it can't be read. */
  vramPeak: number | null;
  cores: number;
}

/** The sysfs directory of a GPU that reports how busy it is, or null. Looked for once. */
const gpuDir = ((): string | null => {
  try {
    for (const card of readdirSync("/sys/class/drm")) {
      if (!/^card\d+$/.test(card)) continue;
      const dir = `/sys/class/drm/${card}/device`;
      if (existsSync(`${dir}/gpu_busy_percent`)) return dir;
    }
  } catch {
    // No sysfs at all: not Linux, or a container without it. Nothing to read, and nothing to report.
  }
  return null;
})();

/** A number out of a sysfs file, or null when it isn't there or isn't a number. */
function readNumber(path: string): number | null {
  try {
    const value = Number(readFileSync(path, "utf8").trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Whether this machine can say how busy its GPU is. */
export const gpuReadable = gpuDir !== null;

const cores = navigator.hardwareConcurrency;

/**
 * Starts watching, and hands back the way to stop. Call `stop()` when the work is done to get what it cost; the
 * sampling stops with it, and the timer never holds the process open.
 */
export function startProbe(): { stop: () => Usage } {
  const startedAt = performance.now();
  const startedCpu = process.cpuUsage();

  let samples = 0;
  let rssTotal = 0;
  let rssPeak = 0;
  let cpuPeak = 0;
  let gpuTotal = 0;
  let gpuSamples = 0;
  let gpuPeak: number | null = null;
  let vramPeak: number | null = null;
  let lastCpu = startedCpu;
  let lastAt = startedAt;

  const sample = (): void => {
    const rss = process.memoryUsage.rss();
    samples++;
    rssTotal += rss;
    if (rss > rssPeak) rssPeak = rss;

    // This sample's share of a core, which is what a peak means: the busiest quarter-second, not the average
    const now = performance.now();
    const cpu = process.cpuUsage();
    const elapsed = now - lastAt;
    if (elapsed > 0) {
      const used = (cpu.user - lastCpu.user + (cpu.system - lastCpu.system)) / 1000;
      cpuPeak = Math.max(cpuPeak, (used / elapsed) * 100);
    }
    lastCpu = cpu;
    lastAt = now;

    if (gpuDir) {
      const busy = readNumber(`${gpuDir}/gpu_busy_percent`);
      if (busy !== null) {
        gpuTotal += busy;
        gpuSamples++;
        gpuPeak = Math.max(gpuPeak ?? 0, busy);
      }
      const vram = readNumber(`${gpuDir}/mem_info_vram_used`);
      if (vram !== null) vramPeak = Math.max(vramPeak ?? 0, vram);
    }
  };

  sample();
  const timer = setInterval(sample, SAMPLE_MS);
  timer.unref?.();

  return {
    stop: (): Usage => {
      clearInterval(timer);
      sample();
      const wallMs = performance.now() - startedAt;
      const cpu = process.cpuUsage(startedCpu);
      const cpuMs = (cpu.user + cpu.system) / 1000;
      return {
        wallMs,
        cpuMs,
        // The average comes from the whole window's processor time, not the mean of the samples: exact, and it
        // can't miss what happened between two of them
        cpuAvg: wallMs > 0 ? (cpuMs / wallMs) * 100 : 0,
        cpuPeak,
        rssAvg: samples > 0 ? rssTotal / samples : 0,
        rssPeak,
        gpuAvg: gpuSamples > 0 ? gpuTotal / gpuSamples : null,
        gpuPeak,
        vramPeak,
        cores,
      };
    },
  };
}

const gb = (bytes: number): string => `${(bytes / 1_073_741_824).toFixed(2)} GB`;

/** One line a person can read: how long it took, and how much of the machine it took. */
export function describeUsage(usage: Usage): string {
  const seconds = `${(usage.wallMs / 1000).toFixed(1)}s`;
  const cpu = `cpu avg ${Math.round(usage.cpuAvg)}% peak ${Math.round(usage.cpuPeak)}% of ${usage.cores * 100}%`;
  const rss = `rss avg ${gb(usage.rssAvg)} peak ${gb(usage.rssPeak)}`;
  // Said apart, because they are read apart: a machine can report its video memory and not its load, or the other
  // way round, and a line that hides one behind the other loses a reading that was there
  const load = usage.gpuAvg === null ? "gpu n/a" : `gpu avg ${Math.round(usage.gpuAvg)}% peak ${Math.round(usage.gpuPeak ?? 0)}%`;
  const vram = usage.vramPeak === null ? "" : ` vram ${gb(usage.vramPeak)}`;
  return `${seconds} · ${cpu} · ${rss} · ${load}${vram}`;
}

/** The same numbers as fields, for a structured log. Bytes become megabytes and percentages whole numbers. */
export function usageFields(usage: Usage): Record<string, number | null> {
  return {
    ms: Math.round(usage.wallMs),
    cpuMs: Math.round(usage.cpuMs),
    cpuAvgPct: Math.round(usage.cpuAvg),
    cpuPeakPct: Math.round(usage.cpuPeak),
    rssAvgMb: Math.round(usage.rssAvg / 1_048_576),
    rssPeakMb: Math.round(usage.rssPeak / 1_048_576),
    gpuAvgPct: usage.gpuAvg === null ? null : Math.round(usage.gpuAvg),
    gpuPeakPct: usage.gpuPeak === null ? null : Math.round(usage.gpuPeak),
    vramPeakMb: usage.vramPeak === null ? null : Math.round(usage.vramPeak / 1_048_576),
  };
}

/** Adds up what several pieces of work cost, as one run: peaks are the highest seen, averages weighted by time. */
export function totalUsage(parts: readonly Usage[]): Usage {
  const wallMs = parts.reduce((sum, p) => sum + p.wallMs, 0);
  const cpuMs = parts.reduce((sum, p) => sum + p.cpuMs, 0);
  const gpuParts = parts.filter((p) => p.gpuAvg !== null);
  const vramParts = parts.filter((p) => p.vramPeak !== null);
  const gpuWall = gpuParts.reduce((sum, p) => sum + p.wallMs, 0);
  return {
    wallMs,
    cpuMs,
    cpuAvg: wallMs > 0 ? (cpuMs / wallMs) * 100 : 0,
    cpuPeak: Math.max(0, ...parts.map((p) => p.cpuPeak)),
    rssAvg: wallMs > 0 ? parts.reduce((sum, p) => sum + p.rssAvg * p.wallMs, 0) / wallMs : 0,
    rssPeak: Math.max(0, ...parts.map((p) => p.rssPeak)),
    gpuAvg: gpuWall > 0 ? gpuParts.reduce((sum, p) => sum + (p.gpuAvg ?? 0) * p.wallMs, 0) / gpuWall : null,
    gpuPeak: gpuParts.length > 0 ? Math.max(0, ...gpuParts.map((p) => p.gpuPeak ?? 0)) : null,
    // Its own reading: how busy a GPU is and how much of its memory is in use come from separate files, and
    // either can be missing without the other. Counting a missing one as zero would understate the total
    vramPeak: vramParts.length > 0 ? Math.max(...vramParts.map((p) => p.vramPeak ?? 0)) : null,
    cores,
  };
}
