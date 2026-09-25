/**
 * The two small routes the extension and the desktop app need beyond the tools themselves.
 *
 * `GET /api/whoami` tells "the server is up" (which `/health` answers to anyone) from "and this key is accepted",
 * so a settings screen can say which of the two is wrong.
 */
import Elysia, { t } from "elysia";
import { ErrBody } from "@/lib/schemas";
import { authContext } from "@/plugins/auth/index";
import { AUTH_FAILED } from "@/services/auth";

export const routeTools = new Elysia()
  .use(authContext)
  .get(
    "/api/whoami",
    ({ principal, status }) => {
      if (!principal) return status(401, { error: AUTH_FAILED });
      return { username: principal.user.username, role: principal.user.role, via: principal.via };
    },
    {
      response: {
        200: t.Object({ username: t.String(), role: t.String(), via: t.String() }),
        401: ErrBody,
      },
    },
  );
