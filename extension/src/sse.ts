/**
 * Server-sent events over `fetch`, so the API key can travel in a header.
 *
 * `EventSource` cannot set headers, which is why these streams used to be opened with a short-lived token in the
 * query string — and a URL is the one place a credential should never be: it goes into proxy logs, browser history,
 * and the Referer of anything the page loads next. A streamed `fetch` carries `X-Api-Key` like every other request
 * the extension makes, at the cost of parsing the frames here rather than in the browser.
 *
 * What is lost with EventSource is its automatic reconnection. That is no great loss: both callers already reopen
 * their own streams with a failure budget, because a token could expire and EventSource would give up for good.
 */

/** The `data` payload of one event, already joined if it arrived over several lines. */
export type SseData = string;

/**
 * Turns a byte stream that arrives in arbitrary pieces into whole events.
 *
 * A chunk boundary can fall anywhere — mid-line, mid-event, between the two newlines that end one — so the parser
 * keeps what it cannot yet finish and returns only events it has all of.
 */
export class SseParser {
  private buffer = "";

  /** Feeds one chunk of text and returns the events it completed, in order. */
  push(chunk: string): SseData[] {
    this.buffer += chunk;
    const events: SseData[] = [];

    // Normalise the three line endings the specification allows, so the split below need only look for one. A CR
    // at the very end is left alone: the LF that pairs with it may be in the next chunk, and turning it into a
    // line ending now would end the frame an instant early — splitting a multi-line event into two half events.
    this.buffer = this.buffer.replace(/\r\n|\r(?!$)/g, "\n");

    let boundary = this.buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);

      const data = dataOf(frame);
      if (data !== null) events.push(data);

      boundary = this.buffer.indexOf("\n\n");
    }
    return events;
  }
}

/**
 * The data of one frame, or null when it carries none — a keepalive comment (`: keepalive`), or a frame of fields
 * this client has no use for. Fields other than `data` are ignored rather than refused: the stream is allowed to
 * grow an `id` or an `event` without this having to know.
 */
function dataOf(frame: string): SseData | null {
  const data: string[] = [];

  for (const line of frame.split("\n")) {
    // Blank lines and comments (": keepalive") carry nothing. A comment would be skipped by the field test below
    // anyway — its field name is empty — but saying so here is what a reader looks for.
    if (line === "" || line.startsWith(":")) continue;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== "data") continue;

    // Everything after the colon, less one optional leading space, is the value.
    const value = colon === -1 ? "" : line.slice(colon + 1);
    data.push(value.startsWith(" ") ? value.slice(1) : value);
  }

  return data.length > 0 ? data.join("\n") : null;
}

/** A stream that is being read. Closing it stops the reading and says nothing further. */
export interface StreamHandle {
  close(): void;
}

export interface StreamHandlers {
  /** The server accepted the request and the first byte is on its way. */
  onOpen?: () => void;
  onMessage: (data: SseData) => void;
  /**
   * The stream is over and was not closed from here: refused, dropped, or ended by the server. Called at most once,
   * and never after `close()`. Callers decide whether to open another one.
   */
  onEnd: (reason: string) => void;
}

/**
 * Opens an event stream and reads it until it ends or is closed.
 *
 * Returns straight away; everything after that arrives through the handlers.
 */
export function openEventStream(url: string, apiKey: string, handlers: StreamHandlers): StreamHandle {
  const controller = new AbortController();
  let finished = false;

  /** Reports the end once, and only if the caller has not already closed the stream. */
  const end = (reason: string): void => {
    if (finished || controller.signal.aborted) return;
    finished = true;
    handlers.onEnd(reason);
  };

  void (async () => {
    try {
      const headers: Record<string, string> = { Accept: "text/event-stream" };
      if (apiKey) headers["X-Api-Key"] = apiKey;

      // A redirect is an error rather than something to follow: fetch keeps a custom header across one, even
      // cross-origin, so following it would hand X-Api-Key to wherever it pointed. Every other call the extension
      // makes refuses redirects for the same reason (see api.ts).
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) {
        end(`the server refused the stream (${response.status})`);
        return;
      }
      if (!response.body) {
        end("the server sent no stream to read");
        return;
      }

      handlers.onOpen?.();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        // `stream: true` so a multi-byte character split across two chunks is held back rather than mangled.
        for (const data of parser.push(decoder.decode(value, { stream: true }))) {
          if (controller.signal.aborted) return;
          handlers.onMessage(data);
        }
      }
      end("the stream ended");
    } catch (err) {
      // An abort is this side closing the stream, which is not something to report back.
      if (controller.signal.aborted) return;
      end(err instanceof Error ? err.message : "the stream failed");
    }
  })();

  return {
    close(): void {
      finished = true;
      controller.abort();
    },
  };
}
