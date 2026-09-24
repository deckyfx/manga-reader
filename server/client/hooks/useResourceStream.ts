import { useEffect, useRef, useState } from "react";
import type { ResourceSample } from "../../src/services/resource-monitor";

/** How much history the graph holds: a minute at a sample a second. */
const KEEP = 60;

export interface ResourceHistory {
  samples: ResourceSample[];
  latest: ResourceSample | null;
  connected: boolean;
}

const EMPTY: ResourceHistory = { samples: [], latest: null, connected: false };

/**
 * Follows the server's resource stream while `watching` is true, keeping the last minute.
 *
 * Nothing is asked of the server unless somebody is looking: closing the display closes the stream, and the server
 * stops sampling when its last watcher goes.
 */
export function useResourceStream(watching: boolean): ResourceHistory {
  const [history, setHistory] = useState<ResourceHistory>(EMPTY);
  const samples = useRef<ResourceSample[]>([]);

  useEffect(() => {
    if (!watching) {
      samples.current = [];
      setHistory(EMPTY);
      return;
    }
    const events = new EventSource("/api/resources/events");
    events.onopen = () => setHistory((current) => ({ ...current, connected: true }));
    events.onmessage = (event: MessageEvent<string>) => {
      const sample = JSON.parse(event.data) as ResourceSample;
      samples.current = [...samples.current, sample].slice(-KEEP);
      setHistory({ samples: samples.current, latest: sample, connected: true });
    };
    // EventSource reconnects by itself; the graph keeps what it has and fills in when samples resume
    events.onerror = () => setHistory((current) => ({ ...current, connected: false }));
    return () => events.close();
  }, [watching]);

  return history;
}
