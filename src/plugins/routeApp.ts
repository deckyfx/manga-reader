import { Elysia } from "elysia";
import { serveUploadedFiles } from "./routeHelpers";
import index from "../public/index.html";

/**
 * React app plugin for DEVELOPMENT mode
 *
 * Serves from src/public with HMR support
 */
export const appPlugin = new Elysia()
  // Manual static file serving for /uploads/* using Bun.file()
  .get("/uploads/*", serveUploadedFiles)
  // React app routes - serve dev HTML with HMR
  .get("/", index) 
  .get("/a/", index)
  .get("/a/*", index)
  .get("/r/", index)
  .get("/r/*", index);
