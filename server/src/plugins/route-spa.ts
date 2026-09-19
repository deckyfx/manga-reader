import Elysia from "elysia";
import index from "../../client/index.html";

/**
 * Client routes that serve the React SPA, passed to Bun.serve through Elysia's `serve.routes`.
 *
 * The HTML bundle can't be returned from an Elysia handler (it would be serialised as `{}`), and Elysia only
 * turns inline values into Bun static routes when no request hooks exist — CORS adds one. Bun matches exact API
 * paths (e.g. `/studio/api/pages/:id`, which Elysia registers too) before these wildcards.
 *
 * `/` is deliberately not here: a static route would override the redirect in `routeRoot`.
 */
export const spaRoutes = {
  "/home": index,
  "/studio": index,
  "/studio/*": index,
  "/read": index,
  "/read/*": index,
  "/manage": index,
  "/manage/*": index,
  "/settings": index,
  "/login": index,
  "/setup": index,
  "/register": index,
  "/admin": index,
  "/admin/*": index,
  "/user": index,
};

/** `/` sends browsers to the landing page that links to the Studio and the reader; there's no favicon yet. */
export const routeRoot = new Elysia()
  .get("/", ({ redirect }) => redirect("/home", 302))
  .get("/favicon.ico", ({ status }) => status(204));
