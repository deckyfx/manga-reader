import { useEffect, useRef, useState } from "react";
import { pageEventsUrl, type PageJobEvent } from "../api";

export interface JobLogLine {
  message: string;
  kind: "log" | "done" | "error";
}

export interface PageJobProgress {
  /** "idle" until events arrive; "error" also covers a progress stream that closed for good (e.g. no live job). */
  status: "idle" | "running" | "done" | "error";
  progress: number;
  step: string;
  lines: JobLogLine[];
  error: string | null;
}

const IDLE: PageJobProgress = { status: "idle", progress: 0, step: "", lines: [], error: null };

/**
 * Follows a page job's progress stream while `pageId` is set. The server replays the job's history on every
 * connect, so late subscribers see the full log and a reconnect after a network blip starts the log afresh.
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
    let ended = false;
    const finish = (outcome: "done" | "error") => {
      ended = true;
      // Close before the server's end-of-stream, or EventSource would reconnect and replay the job again
      es.close();
      finishedRef.current?.(outcome);
    };

    // Each (re)connect replays the whole history: start from a clean log
    es.onopen = () => setState(IDLE);
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
    es.onerror = () => {
      // CONNECTING: the browser is retrying a dropped connection, let it. CLOSED: refused for good (e.g. 404, job expired).
      if (ended || es.readyState !== EventSource.CLOSED) return;
      const message = "Lost the progress stream — the page may still be translating; check the pages list";
      setState((s) => ({ ...s, status: "error", error: message, lines: [...s.lines, { message, kind: "error" }] }));
    };

    return () => {
      ended = true;
      es.close();
    };
  }, [pageId]);

  return state;
}
