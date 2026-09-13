import index from "../../client/index.html";

/**
 * Client routes that serve the React SPA, passed to Bun.serve through Elysia's `serve.routes`.
 *
 * The HTML bundle can't be returned from an Elysia handler (it would be serialised as `{}`), and Elysia
 * only turns inline values into Bun static routes when no request hooks exist — CORS adds one. Bun matches
 * exact API paths (e.g. `/studio/api/pages/:id`, which Elysia registers too) before these wildcards.
 */
export const spaRoutes = {
  "/": index,
  "/studio": index,
  "/studio/*": index,
  "/read": index,
  "/read/*": index,
  "/settings": index,
};
