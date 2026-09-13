/** Mirrors C# BootState — tracks readiness of each service component. */
export class BootState {
  private static instance: BootState;

  isReady = false;
  ocrReady = false;
  translateReady = false;
  dictionaryReady = false;
  inpaintReady = false;
  bubbleReady = false;
  textSegReady = false;

  inpaintEnabled = false;
  bubbleEnabled = false;
  textSegEnabled = false;

  /** Per-file download progress: label → 0-100, or -1 while waiting for Content-Length. */
  readonly downloadProgress: Map<string, number> = new Map();

  setDownloadProgress(label: string, pct: number): void {
    this.downloadProgress.set(label, pct);
  }

  /** Snapshot of in-progress downloads (only those not yet at 100%). */
  get activeDownloads(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [label, pct] of this.downloadProgress) {
      if (pct < 100) result[label] = pct;
    }
    return result;
  }

  get healthStatus(): "starting" | "ready" | "degraded" {
    if (!this.isReady) return "starting";
    if (!this.dictionaryReady) return "degraded";
    return "ready";
  }

  static getInstance(): BootState {
    if (!BootState.instance) BootState.instance = new BootState();
    return BootState.instance;
  }
}

export const bootState = BootState.getInstance();
