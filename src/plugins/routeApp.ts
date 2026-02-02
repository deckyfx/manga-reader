import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import index from "../public/index.html";

/**
 * React app plugin - handles HTML serving, static files, and client-side routing
 *
 * IMPORTANT: Static plugin must be registered BEFORE wildcard routes
 */
export const appPlugin = new Elysia()
  // Static files FIRST - handles /uploads/*
  .use(
    staticPlugin({
      assets: "src/public/uploads",
      prefix: "/uploads",
      alwaysStatic: true, // Force static file serving
    }),
  )
  // React app routes AFTER - handles everything else
  .get("/", index);
