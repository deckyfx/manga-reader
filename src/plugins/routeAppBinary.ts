import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { serveUploadedFiles } from "./routeHelpers";

/**
 * React app plugin for BINARY mode
 *
 * Serves pre-built assets from dist folder
 */

const index = async () => Bun.file("./dist/public/index.html");

export const appPluginBinary = new Elysia()
  // Serve static files from dist
  .use(
    staticPlugin({
      assets: "./dist",
      prefix: "/",
    }),
  )
  // Manual static file serving for /uploads/* using Bun.file()
  .get("/uploads/*", serveUploadedFiles)
  // React app routes - serve built HTML
  .get("/", index)
  .get("/a/", index)
  .get("/a/*", index)
  .get("/r/", index)
  .get("/r/*", index)
  .get("/font-test", index);
