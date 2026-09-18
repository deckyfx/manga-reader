/**
 * `GET /api/whoami` — who an API key belongs to.
 *
 * The extension and the desktop app use it to tell "the server is up" (which `/health` already answers, to anyone)
 * from "and this key is accepted", so their settings screens can say which is wrong. It needs the contributor role,
 * exactly like the tools it stands in for.
 */
import Elysia, { t } from "elysia";
import { ErrBody } from "@/lib/schemas";
import { authContext } from "@/plugins/auth/index";

export const routeWhoami = new Elysia()
  .use(authContext)
  .get(
    "/api/whoami",
    ({ principal, status }) => {
      if (!principal) return status(401, { error: "no account behind this request" });
      return { username: principal.user.username, role: principal.user.role, via: principal.via };
    },
    {
      response: {
        200: t.Object({ username: t.String(), role: t.String(), via: t.String() }),
        401: ErrBody,
      },
    },
  );
