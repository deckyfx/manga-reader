import { useEffect, useRef, useState } from "react";
import { pageEventsUrl, type PageJobEvent } from "../api";

export interface JobLogLine {
  message: string;
  kind: "log" | "done" | "error";
}

export interface PageJobProgress {
  /** "idle" until events arrive, and when no live job exists for the page (e.g. the server restarted). */
  status: "idle" | "running" | "done" | "error";
  progress: number;
  step: string;
  lines: JobLogLine[];
  error: string | null;
}

const IDLE: PageJobProgress = { status: "idle", progress: 0, step: "", lines: [], error: null };

/**
 * Follows a page job's progress stream while `pageId` is set. The server replays the job's history on connect,
 * so late subscribers (e.g. a Studio tab that noticed a re-run) still see the full log.
 * `onFinished` fires once when the job ends.
 */
export function usePageJobEvents(pageId: string | null, onFinished?: (outcome: "done" | "error") => void): PageJobProgress {
  const [state, setState] = useState<PageJobProgress>(IDLE);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  useEffect(() => {
    if (!pageId) return;
    setState(IDLE);
    const es = new EventSource(pageEventsUrl(pageId));
    const finish = (outcome: "done" | "error") => {
      // Close before the server's end-of-stream, or EventSource would reconnect and replay the job again
      es.close();
      finishedRef.current?.(outcome);
    };

    es.onmessage = (event: MessageEvent<string>) => {
      const update = JSON.parse(event.data) as PageJobEvent;
      if (update.type === "progress") {
        setState((s) => ({ ...s, status: "running", progress: update.progress, step: update.message }));
      } else if (update.type === "log") {
        setState((s) => ({ ...s, status: "running", progress: update.progress, step: update.message, lines: [...s.lines, { message: update.message, kind: "log" }] }));
      } else if (update.type === "done") {
        setState((s) => ({ ...s, status: "done", progress: 1, step: update.message, lines: [...s.lines, { message: update.message, kind: "done" }] }));
        finish("done");
      } else {
        setState((s) => ({ ...s, status: "error", error: update.error, lines: [...s.lines, { message: update.error, kind: "error" }] }));
        finish("error");
      }
    };
    // No live job (404) or a dropped connection: stop here; callers fall back to polling the page status
    es.onerror = () => es.close();

    return () => es.close();
  }, [pageId]);

  return state;
}
