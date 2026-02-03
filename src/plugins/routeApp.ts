import { Elysia } from "elysia";
import { join } from "node:path";
import index from "../public/index.html";
import { envConfig } from "../env-config";

/**
 * React app plugin - handles HTML serving, static files, and client-side routing
 *
 * Manual file serving using Bun.file() for better handling of freshly uploaded files
 */
export const appPlugin = new Elysia()
  // Manual static file serving for /uploads/* using Bun.file()
  .get("/uploads/*", async ({ params }) => {
    try {
      // Get the wildcard path (everything after /uploads/)
      const filePath = params["*"];
      const fullPath = join(envConfig.MANGA_DIR, filePath);

      // Serve file using Bun.file()
      const file = Bun.file(fullPath);

      // Check if file exists
      if (await file.exists()) {
        return file;
      }

      // File not found
      return new Response("File not found", { status: 404 });
    } catch (error) {
      console.error("Error serving file:", error);
      return new Response("Error serving file", { status: 500 });
    }
  })
  // React app routes AFTER - handles everything else
  .get("/", index)
  .get("/a/", index)
  .get("/a/*", index)
  .get("/r/", index)
  .get("/r/*", index);
