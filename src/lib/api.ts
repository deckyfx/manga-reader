import { treaty } from "@elysiajs/eden";
import type { App } from "../server";

/**
 * Type-safe API client using Eden Treaty
 *
 * **CLIENT-SIDE ONLY**: Uses window.location to match the current domain/port.
 * This ensures the API calls are made to the same server serving the page.
 *
 * Provides full type safety for all API calls with autocomplete support.
 * NEVER use fetch() directly - always use this api client for type safety.
 */
export const api = treaty<App>(
  typeof window !== "undefined"
    ? window.location.origin // Includes protocol, hostname, and port
    : "http://localhost:3000" // Fallback for SSR (not used in this setup)
);
