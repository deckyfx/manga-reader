import { Elysia } from "elysia";

/**
 * Health check API endpoint
 */
export const healthApi = new Elysia({ prefix: "/health" }).get("/", () => {
  return {
    status: "OK",
    timestamp: new Date().toISOString(),
  };
});
