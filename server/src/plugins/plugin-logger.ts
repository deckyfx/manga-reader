/** Elysia plugin that logs every HTTP request/response with method, path, status, and duration. */

import Elysia from "elysia";
import { childLogger } from "@/lib/logger";

const http = childLogger("http");

export const loggerPlugin = new Elysia({ name: "logger" })
  .derive({ as: "global" }, () => ({ _reqStart: Date.now() }))
  .onAfterResponse({ as: "global" }, ({ request, set, _reqStart }) => {
    const ms = Date.now() - _reqStart;
    const status = set.status ?? 200;
    const method = request.method;
    const url = new URL(request.url);
    // SSE can't send headers, so those streams take a short-lived token in the query — keep it out of the log
    if (url.searchParams.has("stream_token")) url.searchParams.set("stream_token", "redacted");
    const path = url.pathname + (url.search ? url.search : "");

    const level = typeof status === "number" && status >= 500 ? "error"
      : typeof status === "number" && status >= 400 ? "warn"
      : "info";

    http[level]({ method, path, status, ms }, `${method} ${path} ${status} ${ms}ms`);
  })
  .onError({ as: "global" }, ({ request, error, code }) => {
    const url = new URL(request.url);
    const path = url.pathname;
    http.error(
      { method: request.method, path, code, err: error },
      `${request.method} ${path} — ${code}`,
    );
  });
