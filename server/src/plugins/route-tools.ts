/**
 * The two small routes the extension and the desktop app need beyond the tools themselves.
 *
 * `GET /api/whoami` tells "the server is up" (which `/health` answers to anyone) from "and this key is accepted",
 * so a settings screen can say which of the two is wrong.
 *
 * `POST /api/stream-token` hands out a short-lived token for the progress streams. EventSource cannot set headers,
 * so a stream's credential has to travel in the URL — and a URL reaches logs, history and referrers. This token
 * lasts minutes and opens nothing but those streams, so the durable API key never goes there.
 */
import Elysia, { t } from "elysia";
import { ErrBody } from "@/lib/schemas";
import { authContext } from "@/plugins/auth/index";
import { AUTH_FAILED, issueStreamToken } from "@/services/auth";

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
  )

  .post(
    "/api/stream-token",
    ({ principal, status }) => {
      if (!principal) return status(401, { error: AUTH_FAILED });
      return issueStreamToken(principal.user.id);
    },
    { response: { 200: t.Object({ token: t.String(), expires_in: t.Integer() }), 401: ErrBody } },
  );
