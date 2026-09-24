/**
 * `GET /api/resources/events` — what the machine is doing, a sample a second, for as long as someone watches.
 *
 * A stream rather than polling because the point is to watch a stage happen: a page's heavy work lasts a few
 * seconds, and polling either misses it or asks constantly in case it starts. The server samples only while
 * somebody is connected (see services/resource-monitor).
 */
import Elysia from "elysia";
import { gpuAvailable, sampleResources, watchResources } from "@/services/resource-monitor";

/** Comment sent on an idle stream so proxies and the browser keep the connection open. */
const KEEPALIVE_MS = 25_000;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export const routeResources = new Elysia().get("/api/resources/events", () => {
  const encoder = new TextEncoder();
  let stop = (): void => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string): void => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          stop();
        }
      };
      const unwatch = watchResources((sample) => send(`data: ${JSON.stringify(sample)}\n\n`));
      const keepalive = setInterval(() => send(": keepalive\n\n"), KEEPALIVE_MS);
      stop = () => {
        clearInterval(keepalive);
        unwatch();
      };
      send(": connected\n\n");
      // Where things stand now, so a watcher has something to show before the first tick
      send(`data: ${JSON.stringify({ ...sampleResources(), gpuAvailable })}\n\n`);
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
});
