import { Elysia } from "elysia";
import { envConfig } from "./env-config";
import { apiPlugin } from "./plugins/routeApi";
import { appPlugin } from "./plugins/routeApp";

/**
 * Main Elysia server with API and React app plugins
 */
const app = new Elysia()
  .use(apiPlugin) // API routes first
  .use(appPlugin) // React app last (wildcard route)
  .listen(envConfig.SERVER_PORT);

console.log(`🚀 Server running at http://localhost:${envConfig.SERVER_PORT}`);

// Export App type for Eden Treaty
export type App = typeof app;
