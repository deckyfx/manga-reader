import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import index from "../public/index.html";

/**
 * React app plugin - handles HTML serving, static files, and client-side routing
 *
 * IMPORTANT: Static plugin must be registered BEFORE wildcard routes
 */
export const appPlugin = new Elysia()
  .use(
    staticPlugin({
      assets: "src/public/uploads",
      prefix: "/uploads",
      alwaysStatic: true, // Force static file serving
    }),
  )
  // React app routes AFTER - handles everything else
  .get("/", index)
  .get("/a/", index)
  .get("/a/*", index)
  .get("/r/", index)
  .get("/r/*", index);
