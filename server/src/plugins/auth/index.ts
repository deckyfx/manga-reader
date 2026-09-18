/**
 * Who is asking (`/auth/api`), and the guard the other areas use.
 *
 * GET  /auth/api/me        the signed-in account, or null, plus whether the server still needs setting up
 * POST /auth/api/setup     create the first admin — only while there are no accounts at all
 * POST /auth/api/login     sign in, setting the session cookie
 * POST /auth/api/login/totp      finish a sign-in with a code from an authenticator app
 * POST /auth/api/login/recovery  finish a sign-in with a recovery code
 * POST /auth/api/totp/start      begin enrolling: returns the secret and the otpauth:// URI
 * POST /auth/api/totp/enable     confirm a code and turn TOTP on, answering with the recovery codes
 * POST /auth/api/totp/disable    turn it off again (password required)
 * POST /auth/api/recovery        replace the recovery codes
 * POST /auth/api/logout    end this session
 * POST /auth/api/password  change your own password (every other session is signed out)
 * GET/POST/DELETE /auth/api/keys  your API keys for the extension and the desktop app
 *
 * `/read/api` stays public. `/studio/api`, `/manage/api` and the tool routes go through `requireRole`.
 */
import Elysia, { t } from "elysia";
import { childLogger } from "@/lib/logger";
import { ErrBody } from "@/lib/schemas";
import {
  authenticate,
  checkTotp,
  disableTotp,
  endMfaChallenge,
  issueRecoveryCodes,
  pendingUser,
  secondFactors,
  startMfaChallenge,
  useRecoveryCode,
  createApiKey,
  endSession,
  hasRole,
  hashPassword,
  needsSetup,
  SESSION_COOKIE,
  startSession,
  userForApiKey,
  userForSession,
  verifyPassword,
  type Principal,
} from "@/services/auth";
import { ApiKeyStore, RecoveryCodeStore, SessionStore, UserStore } from "@/stores/user-store";
import { newTotpSecret, otpauthUri, verifyTotp } from "@/services/totp";
import { USER_ROLES, type User, type UserRole } from "@/db/schema";

const log = childLogger("auth");

const Username = t.String({ minLength: 2, maxLength: 40, pattern: "^[A-Za-z0-9._-]+$" });
const Password = t.String({ minLength: 8, maxLength: 200 });

export const UserSchema = t.Object({
  id: t.Integer(),
  username: t.String(),
  display_name: t.Nullable(t.String()),
  role: t.UnionEnum([...USER_ROLES]),
  disabled: t.Boolean(),
  email: t.Nullable(t.String()),
  /** Whether an authenticator app guards this account. */
  totp_enabled: t.Boolean(),
  last_seen_at: t.Nullable(t.String()),
  created_at: t.String(),
});

export const toUser = (user: User) => ({
  id: user.id,
  username: user.username,
  display_name: user.displayName,
  role: (USER_ROLES as readonly string[]).includes(user.role) ? (user.role as UserRole) : ("reader" as const),
  disabled: user.disabledAt !== null,
  email: user.email,
  totp_enabled: user.totpEnabledAt !== null,
  last_seen_at: user.lastSeenAt,
  created_at: user.createdAt,
});

/** Either a session was created (`user`), or a second factor is still needed (`challenge`). */
const LoginResult = t.Object({
  user: t.Nullable(UserSchema),
  mfa_required: t.Boolean(),
  methods: t.Array(t.UnionEnum(["totp", "passkey"])),
  challenge: t.Nullable(t.String()),
});

const ApiKeySchema = t.Object({
  id: t.Integer(),
  name: t.String(),
  prefix: t.String(),
  last_used_at: t.Nullable(t.String()),
  revoked: t.Boolean(),
  created_at: t.String(),
});

/**
 * Resolves who is asking, from the session cookie or an `X-Api-Key` header. Adds `principal` to the context; it is
 * null for anyone signed out, which is fine for the reader and refused everywhere else.
 */
export const authContext = new Elysia({ name: "auth-context" })
  .derive({ as: "global" }, async ({ cookie, headers }): Promise<{ principal: Principal | null }> => {
    const key = headers["x-api-key"];
    if (key) {
      const match = await userForApiKey(key);
      if (match) {
        void ApiKeyStore.touch(match.apiKeyId);
        return { principal: { user: match.user, via: "api-key", apiKeyId: match.apiKeyId } };
      }
      return { principal: null };
    }
    const token = cookie[SESSION_COOKIE]?.value;
    if (typeof token !== "string" || token.length === 0) return { principal: null };
    const user = await userForSession(token);
    return { principal: user ? { user, via: "session" } : null };
  });

/**
 * Guards a whole area: 401 when nobody is signed in, 403 when the account isn't allowed. Use it with `.use()` inside
 * the plugin it protects, before its routes.
 */
export const requireRole = (role: UserRole) =>
  new Elysia({ name: `require-${role}` })
    .use(authContext)
    .onBeforeHandle({ as: "scoped" }, ({ principal, status }) => {
      if (!principal) return status(401, { error: "sign in to do that" });
      if (!hasRole(principal.user, role)) return status(403, { error: `this needs the ${role} role` });
      return undefined;
    });

/** Sets or clears the session cookie. Secure is set only over https, so a loopback server still works. */
function writeSessionCookie(cookie: Record<string, { set: (options: Record<string, unknown>) => void; remove: () => void }>, url: string, token: string | null, expires?: Date): void {
  const jar = cookie[SESSION_COOKIE];
  if (!jar) return;
  if (token === null) {
    jar.remove();
    return;
  }
  jar.set({
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: url.startsWith("https://"),
    expires,
  });
}

export const authPlugin = new Elysia({ prefix: "/auth/api" })
  .use(authContext)

  .get(
    "/me",
    async ({ principal }) => ({
      user: principal ? toUser(principal.user) : null,
      via: principal?.via ?? null,
      needs_setup: await needsSetup(),
    }),
    { response: { 200: t.Object({ user: t.Nullable(UserSchema), via: t.Nullable(t.String()), needs_setup: t.Boolean() }) } },
  )

  .post(
    "/setup",
    async ({ body, cookie, request, status }) => {
      // Only ever available on an empty install; afterwards accounts are made by an admin
      if (!(await needsSetup())) return status(409, { error: "this server already has an account" });
      const user = await UserStore.insert({
        username: body.username,
        displayName: body.display_name ?? null,
        passwordHash: await hashPassword(body.password),
        role: "admin",
      });
      const { token, expiresAt } = await startSession(user.id, request.headers.get("user-agent"));
      writeSessionCookie(cookie, request.url, token, expiresAt);
      log.info({ userId: user.id, username: user.username }, "First admin created");
      return toUser(user);
    },
    {
      body: t.Object({ username: Username, password: Password, display_name: t.Optional(t.Nullable(t.String({ maxLength: 80 }))) }),
      response: { 200: UserSchema, 409: ErrBody },
    },
  )

  .post(
    "/login",
    async ({ body, cookie, request, status }) => {
      const user = await authenticate(body.username, body.password);
      if (!user) {
        log.warn({ username: body.username }, "Failed sign-in");
        return status(401, { error: "wrong username or password" });
      }
      // A second factor means no session yet: the password only buys a short-lived challenge
      const factors = await secondFactors(user);
      if (factors.length > 0) {
        const challenge = await startMfaChallenge(user.id, request.headers.get("user-agent"));
        return { user: null, mfa_required: true, methods: factors, challenge };
      }
      const { token, expiresAt } = await startSession(user.id, request.headers.get("user-agent"));
      writeSessionCookie(cookie, request.url, token, expiresAt);
      await UserStore.touch(user.id);
      return { user: toUser(user), mfa_required: false, methods: [], challenge: null };
    },
    {
      body: t.Object({ username: t.String({ maxLength: 40 }), password: t.String({ maxLength: 200 }) }),
      response: { 200: LoginResult, 401: ErrBody },
    },
  )

  .post(
    "/login/totp",
    async ({ body, cookie, request, status }) => {
      const pending = await pendingUser(body.challenge);
      if (!pending) return status(401, { error: "this sign-in has expired — start again" });
      if (!checkTotp(pending.user, body.code)) {
        log.warn({ userId: pending.user.id }, "Wrong authenticator code");
        return status(401, { error: "that code isn't right" });
      }
      // One challenge, one sign-in
      await endMfaChallenge(pending.tokenHash);
      const { token, expiresAt } = await startSession(pending.user.id, request.headers.get("user-agent"));
      writeSessionCookie(cookie, request.url, token, expiresAt);
      await UserStore.touch(pending.user.id);
      return { user: toUser(pending.user), mfa_required: false, methods: [], challenge: null };
    },
    {
      body: t.Object({ challenge: t.String({ maxLength: 200 }), code: t.String({ maxLength: 10 }) }),
      response: { 200: LoginResult, 401: ErrBody },
    },
  )

  .post(
    "/login/recovery",
    async ({ body, cookie, request, status }) => {
      const pending = await pendingUser(body.challenge);
      if (!pending) return status(401, { error: "this sign-in has expired — start again" });
      if (!(await useRecoveryCode(pending.user.id, body.code))) {
        log.warn({ userId: pending.user.id }, "Wrong or spent recovery code");
        return status(401, { error: "that recovery code isn't right, or has been used" });
      }
      await endMfaChallenge(pending.tokenHash);
      const { token, expiresAt } = await startSession(pending.user.id, request.headers.get("user-agent"));
      writeSessionCookie(cookie, request.url, token, expiresAt);
      const left = (await RecoveryCodeStore.listUnused(pending.user.id)).length;
      log.info({ userId: pending.user.id, left }, "Signed in with a recovery code");
      return { user: toUser(pending.user), mfa_required: false, methods: [], challenge: null };
    },
    {
      body: t.Object({ challenge: t.String({ maxLength: 200 }), code: t.String({ maxLength: 40 }) }),
      response: { 200: LoginResult, 401: ErrBody },
    },
  )

  // ── Enrolling an authenticator app ─────────────────────────────────────────

  .post(
    "/totp/start",
    async ({ principal, status }) => {
      if (!principal) return status(401, { error: "sign in to do that" });
      if (principal.user.totpEnabledAt) return status(409, { error: "this account already uses an authenticator app" });
      // Stored unconfirmed: it guards nothing until a code proves the app has it too
      const secret = newTotpSecret();
      await UserStore.update(principal.user.id, { totpSecret: secret });
      return { secret, uri: otpauthUri(secret, principal.user.username) };
    },
    { response: { 200: t.Object({ secret: t.String(), uri: t.String() }), 401: ErrBody, 409: ErrBody } },
  )

  .post(
    "/totp/enable",
    async ({ principal, body, status }) => {
      if (!principal) return status(401, { error: "sign in to do that" });
      const secret = principal.user.totpSecret;
      if (!secret) return status(409, { error: "start the enrolment first" });
      if (principal.user.totpEnabledAt) return status(409, { error: "this account already uses an authenticator app" });
      if (!verifyTotp(secret, body.code)) return status(422, { error: "that code isn't right — check the app's clock" });
      await UserStore.update(principal.user.id, { totpEnabledAt: new Date().toISOString() });
      // Shown once: the only way back in if the phone is lost
      const codes = await issueRecoveryCodes(principal.user.id);
      log.info({ userId: principal.user.id }, "Authenticator app enrolled");
      return { enabled: true, recovery_codes: codes };
    },
    {
      body: t.Object({ code: t.String({ maxLength: 10 }) }),
      response: { 200: t.Object({ enabled: t.Boolean(), recovery_codes: t.Array(t.String()) }), 401: ErrBody, 409: ErrBody, 422: ErrBody },
    },
  )

  .post(
    "/totp/disable",
    async ({ principal, body, status }) => {
      if (!principal) return status(401, { error: "sign in to do that" });
      // The password again: a borrowed session shouldn't be able to strip a factor off the account
      if (!(await verifyPassword(body.password, principal.user.passwordHash))) return status(403, { error: "the password doesn't match" });
      await disableTotp(principal.user.id);
      log.info({ userId: principal.user.id }, "Authenticator app removed");
      return { disabled: true };
    },
    {
      body: t.Object({ password: t.String({ maxLength: 200 }) }),
      response: { 200: t.Object({ disabled: t.Boolean() }), 401: ErrBody, 403: ErrBody },
    },
  )

  .post(
    "/recovery",
    async ({ principal, body, status }) => {
      if (!principal) return status(401, { error: "sign in to do that" });
      if (!(await verifyPassword(body.password, principal.user.passwordHash))) return status(403, { error: "the password doesn't match" });
      const codes = await issueRecoveryCodes(principal.user.id);
      return { recovery_codes: codes };
    },
    {
      body: t.Object({ password: t.String({ maxLength: 200 }) }),
      response: { 200: t.Object({ recovery_codes: t.Array(t.String()) }), 401: ErrBody, 403: ErrBody },
    },
  )

  .post(
    "/logout",
    async ({ cookie, request }) => {
      const token = cookie[SESSION_COOKIE]?.value;
      if (typeof token === "string" && token) await endSession(token);
      writeSessionCookie(cookie, request.url, null);
      return { signed_out: true };
    },
    { response: { 200: t.Object({ signed_out: t.Boolean() }) } },
  )

  .post(
    "/password",
    async ({ principal, body, cookie, request, status }) => {
      if (!principal) return status(401, { error: "sign in to do that" });
      if (!(await verifyPassword(body.current, principal.user.passwordHash))) return status(403, { error: "the current password doesn't match" });
      await UserStore.update(principal.user.id, { passwordHash: await hashPassword(body.next) });
      // Every session goes, including this one: a password change signs the account out everywhere
      await SessionStore.deleteForUser(principal.user.id);
      const { token, expiresAt } = await startSession(principal.user.id, request.headers.get("user-agent"));
      writeSessionCookie(cookie, request.url, token, expiresAt);
      log.info({ userId: principal.user.id }, "Password changed");
      return { changed: true };
    },
    {
      body: t.Object({ current: t.String({ maxLength: 200 }), next: Password }),
      response: { 200: t.Object({ changed: t.Boolean() }), 401: ErrBody, 403: ErrBody },
    },
  )

  // ── API keys, for the extension and the desktop app ────────────────────────

  .get(
    "/keys",
    async ({ principal, status }) => {
      if (!principal) return status(401, { error: "sign in to do that" });
      const keys = await ApiKeyStore.listByUser(principal.user.id);
      return keys.map((key) => ({
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        last_used_at: key.lastUsedAt,
        revoked: key.revokedAt !== null,
        created_at: key.createdAt,
      }));
    },
    { response: { 200: t.Array(ApiKeySchema), 401: ErrBody } },
  )

  .post(
    "/keys",
    async ({ principal, body, status }) => {
      if (!principal) return status(401, { error: "sign in to do that" });
      if (!hasRole(principal.user, "contributor")) return status(403, { error: "this needs the contributor role" });
      // The only time the key itself is readable: it is stored hashed
      const created = await createApiKey(principal.user.id, body.name);
      return { id: created.id, name: body.name, prefix: created.prefix, key: created.key };
    },
    {
      body: t.Object({ name: t.String({ minLength: 1, maxLength: 60 }) }),
      response: { 200: t.Object({ id: t.Integer(), name: t.String(), prefix: t.String(), key: t.String() }), 401: ErrBody, 403: ErrBody },
    },
  )

  .delete(
    "/keys/:id",
    async ({ principal, params, status }) => {
      if (!principal) return status(401, { error: "sign in to do that" });
      const key = await ApiKeyStore.findById(params.id);
      if (!key || key.userId !== principal.user.id) return status(404, { error: "key not found" });
      await ApiKeyStore.revoke(params.id);
      return { revoked: true };
    },
    {
      params: t.Object({ id: t.Integer({ minimum: 1 }) }),
      response: { 200: t.Object({ revoked: t.Boolean() }), 401: ErrBody, 404: ErrBody },
    },
  );
