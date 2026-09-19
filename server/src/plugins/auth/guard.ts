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

/**
 * What a path needs: nothing, a role, and whether a tool's API key may be used at all. First match wins, so order
 * matters. `sessionOnly` marks the places where a stolen extension key must not reach — an API key exists to run
 * OCR, not to hand out accounts. `exact` matches that one path only; without it an entry covers its whole subtree.
 */
const POLICY: { prefix: string; needs: UserRole | "public"; sessionOnly?: boolean; exact?: boolean }[] = [
  // Reading is open to everyone, signed in or not
  { prefix: "/read/api", needs: "public" },
  // Signing in, setting up, registering and asking who you are. Listed one by one rather than as all of /auth/api,
  // so an account route added later falls to the closed default instead of being public. Exact paths, for the same
  // reason: nothing nested under a public route inherits it.
  { prefix: "/auth/api/me", needs: "public", exact: true },
  { prefix: "/auth/api/setup", needs: "public", exact: true },
  { prefix: "/auth/api/register", needs: "public", exact: true },
  { prefix: "/auth/api/login", needs: "public", exact: true },
  { prefix: "/auth/api/login/totp", needs: "public", exact: true },
  { prefix: "/auth/api/login/recovery", needs: "public", exact: true },
  { prefix: "/auth/api/login/passkey", needs: "public", exact: true },
  { prefix: "/auth/api/login/passkey/options", needs: "public", exact: true },
  { prefix: "/auth/api/logout", needs: "public", exact: true },
  // Your own account: any role, from the browser only (a tool's key must not add factors, mint keys or list sessions)
  { prefix: "/auth/api/password", needs: "reader", sessionOnly: true },
  { prefix: "/auth/api/recovery", needs: "reader", sessionOnly: true },
  { prefix: "/auth/api/totp", needs: "reader", sessionOnly: true },
  { prefix: "/auth/api/passkeys", needs: "reader", sessionOnly: true },
  { prefix: "/auth/api/sessions", needs: "reader", sessionOnly: true },
  // Listing is open to every account (a reader sees the section, disabled); creating one checks for a contributor
  { prefix: "/auth/api/keys", needs: "reader", sessionOnly: true },
  // Readiness, so a client can tell "still loading models" from "needs a key"
  { prefix: "/health", needs: "public" },

  // Accounts and roles are the admin's business (listed first: the general /manage rule would be too weak)
  { prefix: "/manage/api/users", needs: "admin", sessionOnly: true },
  { prefix: "/manage/api/settings", needs: "admin", sessionOnly: true },
  { prefix: "/manage/api/sessions", needs: "admin", sessionOnly: true },

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

/** The rule for a path; anything unlisted needs an admin through a browser, so a new route is never left open. */
export function ruleFor(pathname: string): { needs: UserRole | "public"; sessionOnly: boolean } {
  const rule = POLICY.find((entry) => pathname === entry.prefix || (!entry.exact && pathname.startsWith(`${entry.prefix}/`)));
  return { needs: rule?.needs ?? "admin", sessionOnly: rule?.sessionOnly ?? rule === undefined };
}

/** Just the role, for tests and for anything that only cares about that. */
export const policyFor = (pathname: string): UserRole | "public" => ruleFor(pathname).needs;

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
    const { needs, sessionOnly } = ruleFor(url.pathname);
    if (needs === "public") return undefined;

    if (!principal) {
      // Somebody following a link deserves the sign-in screen, not a JSON error; everything else gets the 401
      if (isBrowserNavigation(request)) {
        return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
      }
      return status(401, { error: AUTH_FAILED });
    }

    if (!hasRole(principal.user, needs)) return status(403, { error: `this needs the ${needs} role` });
    // An admin's API key is still only a key: accounts, server settings and sessions want the browser
    if (sessionOnly && principal.via !== "session") {
      return status(403, { error: "this needs a signed-in browser, not an API key" });
    }
    return undefined;
  });
