/**
 * One place that decides what a request needs. A table beats hooks spread over the plugins: the whole policy can be
 * read at once, and it fails closed — a path nobody listed needs an account.
 *
 * The SPA's own pages are served by Bun's `serve.routes`, outside Elysia, so they never reach this; the client shows
 * the sign-in screen and the API refuses anything it shouldn't serve.
 */
import Elysia from "elysia";
import { authContext } from "@/plugins/auth/index";
import { AUTH_FAILED, hasRole } from "@/services/auth";
import type { UserRole } from "@/db/schema";

/** What a path needs: nothing, or a role. First match wins, so order matters. */
const POLICY: { prefix: string; needs: UserRole | "public" }[] = [
  // Reading is open to everyone, signed in or not
  { prefix: "/read/api", needs: "public" },
  // Signing in, and asking who you are
  { prefix: "/auth/api", needs: "public" },
  // Readiness, so a client can tell "still loading models" from "needs a key"
  { prefix: "/health", needs: "public" },

  // Accounts and roles are the admin's business (listed first: the general /manage rule would be too weak)
  { prefix: "/manage/api/users", needs: "admin" },
  { prefix: "/manage/api/settings", needs: "admin" },
  { prefix: "/manage/api/sessions", needs: "admin" },

  // Building the library and editing pages
  { prefix: "/manage/api", needs: "contributor" },
  { prefix: "/studio/api", needs: "contributor" },

  // The tools: OCR, translation, dictionary and page jobs, for the extension and the desktop app
  { prefix: "/ocr", needs: "contributor" },
  { prefix: "/jobs", needs: "contributor" },
  { prefix: "/translate", needs: "contributor" },
  { prefix: "/analyze", needs: "contributor" },
  { prefix: "/api/translate-page", needs: "contributor" },
  { prefix: "/api/whoami", needs: "contributor" },
  { prefix: "/api/stream-token", needs: "contributor" },
  { prefix: "/api/settings", needs: "contributor" },
];

/** The rule for a path; anything unlisted needs an admin, so a new route is never accidentally public. */
export function policyFor(pathname: string): UserRole | "public" {
  return POLICY.find((rule) => pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`))?.needs ?? "admin";
}

/**
 * Whether this is a person typing a URL rather than a program calling an API. A top-level navigation says so
 * outright (`Sec-Fetch-Mode: navigate`); otherwise asking for HTML and not for JSON is the next best sign. The
 * SPA's own calls, the extension and the desktop app all ask for JSON, and SSE asks for text/event-stream.
 */
function isBrowserNavigation(request: Request): boolean {
  if (request.method !== "GET") return false;
  if (request.headers.get("sec-fetch-mode") === "navigate") return true;
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html") && !accept.includes("application/json");
}

/**
 * Applies the table to every Elysia route. Registered once, at the top of the app, so no plugin can forget it.
 */
export const authGuard = new Elysia({ name: "auth-guard" })
  .use(authContext)
  .onBeforeHandle({ as: "global" }, ({ request, principal, status, redirect }) => {
    const url = new URL(request.url);
    const needs = policyFor(url.pathname);
    if (needs === "public") return undefined;

    if (!principal) {
      // Somebody following a link deserves the sign-in screen, not a JSON error; everything else gets the 401
      if (isBrowserNavigation(request)) {
        return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
      }
      return status(401, { error: AUTH_FAILED });
    }

    if (!hasRole(principal.user, needs)) return status(403, { error: `this needs the ${needs} role` });
    return undefined;
  });
