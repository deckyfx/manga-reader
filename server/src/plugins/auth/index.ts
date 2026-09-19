/**
 * Who is asking (`/auth/api`), and the guard the other areas use.
 *
 * GET  /auth/api/me        the signed-in account, or null, plus whether the server still needs setting up
 * POST /auth/api/setup     create the first admin — only while there are no accounts at all
 * POST /auth/api/register  create your own account, when an admin has switched registration on
 * POST /auth/api/login     sign in, setting the session cookie
 * POST /auth/api/login/totp      finish a sign-in with a code from an authenticator app
 * POST /auth/api/login/recovery  finish a sign-in with a recovery code
 * POST   /auth/api/login/passkey/options  the WebAuthn request for a sign-in waiting on a second factor
 * POST   /auth/api/login/passkey          finish that sign-in with the authenticator's answer
 * GET    /auth/api/passkeys      the passkeys on this account
 * POST   /auth/api/passkeys/options  start enrolling one (signed in; a passkey never creates an account)
 * POST   /auth/api/passkeys      store the new passkey
 * DELETE /auth/api/passkeys/:id  remove one (password required)
 * GET    /auth/api/totp         the authenticators on this account
 * POST   /auth/api/totp         add one: returns the secret and the otpauth:// URI to scan
 * POST   /auth/api/totp/:id/confirm  prove the app has it; the first one answers with the recovery codes
 * DELETE /auth/api/totp/:id     remove one (password required)
 * POST /auth/api/recovery        replace the recovery codes
 * POST /auth/api/logout    end this session
 * POST /auth/api/password  change your own password (every other session is signed out)
 * GET/POST/DELETE /auth/api/keys  your API keys for the extension and the desktop app
 * GET    /auth/api/sessions     where this account is signed in
 * DELETE /auth/api/sessions/:id sign one of them out
 *
 * `/read/api` stays public. `/studio/api`, `/manage/api` and the tool routes go through `requireRole`.
 */
import Elysia, { t } from "elysia";
import { childLogger } from "@/lib/logger";
import { ErrBody } from "@/lib/schemas";
import { RateLimiter } from "@/lib/rate-limit";
import { env } from "@/env";
import {
  AUTH_FAILED,
  authenticate,
  checkTotp,
  removeTotpDevice,
  spendMfaAttempt,
  withAccountLock,
  endMfaChallenge,
  issueRecoveryCodes,
  pendingUser,
  secondFactors,
  startMfaChallenge,
  hashSecret,
  userForStreamToken,
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
import { ApiKeyStore, CredentialStore, MfaChallengeStore, normaliseUsername, RecoveryCodeStore, SessionStore, TotpDeviceStore, UserStore } from "@/stores/user-store";
import { newTotpSecret, otpauthUri, verifyTotp } from "@/services/totp";
import { authenticationOptions, registrationOptions, saveRegistration, verifyAssertion } from "@/services/passkeys";
import { USER_ROLES, type User, type UserRole } from "@/db/schema";
import { serverPolicy } from "@/services/server-settings";

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

export const SessionSchema = t.Object({
  id: t.String(),
  /** The session this request came in on, which the UI marks rather than offers to end. */
  current: t.Boolean(),
  user_agent: t.Nullable(t.String()),
  last_seen_at: t.String(),
  created_at: t.String(),
  expires_at: t.String(),
});

const PasskeySchema = t.Object({
  id: t.String(),
  name: t.String(),
  last_used_at: t.Nullable(t.String()),
  created_at: t.String(),
});

const TotpDeviceSchema = t.Object({
  id: t.Integer(),
  name: t.String(),
  /** False while the enrolment is half-finished: such a device guards nothing. */
  confirmed: t.Boolean(),
  last_used_at: t.Nullable(t.String()),
  created_at: t.String(),
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
  .derive({ as: "global" }, async ({ cookie, headers, request }): Promise<{ principal: Principal | null }> => {
    // EventSource cannot set headers, so the two SSE streams take a short-lived stream token in the query instead —
    // never the API key itself, which would then live in logs, history and referrers.
    const url = new URL(request.url);
    const streaming = url.pathname.endsWith("/events") || url.pathname.endsWith("/live");
    if (streaming) {
      const streamToken = url.searchParams.get("stream_token");
      if (streamToken) {
        const user = await userForStreamToken(streamToken);
        if (user) return { principal: { user, via: "stream-token" } };
        return { principal: null };
      }
    }
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
      if (!principal) return status(401, { error: AUTH_FAILED });
      // A tool's key runs OCR; it must not be able to add a passkey, mint another key or list sessions
      if (principal.via !== "session") return status(403, { error: "this needs a signed-in browser, not an API key" });
      if (!hasRole(principal.user, role)) return status(403, { error: `this needs the ${role} role` });
      return undefined;
    });

/** Sets or clears the session cookie. Secure is set only over https, so a loopback server still works. */
type Server = { requestIP: (request: Request) => { address: string } | null } | null;

/** Requests whose direct peer is a trusted proxy, so their forwarded headers may be believed. */
const viaTrustedProxy = new WeakSet<Request>();

/** Whether the browser reached us over https: directly, or through a trusted proxy that terminated TLS. */
function isHttps(request: Request): boolean {
  if (request.url.startsWith("https://")) return true;
  if (!viaTrustedProxy.has(request)) return false;
  return request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https";
}

/** Who is asking, for sign-in limits: the socket's address, or a trusted proxy's report of it. */
function clientAddress(request: Request, server: Server): string {
  if (viaTrustedProxy.has(request)) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return server?.requestIP(request)?.address ?? "unknown";
}

/**
 * Password checks are argon2id, deliberately slow: unbounded, they are both a guessing channel and a way to starve
 * real sign-ins. Every attempt counts (not only failures), so a burst is cut off before it reaches the hash.
 */
const loginsPerAddress = new RateLimiter(50, 15 * 60_000);
const loginsPerAccount = new RateLimiter(10, 15 * 60_000);
/** Making an account hashes its password too: setup and self-registration share this, per address. */
const accountsPerAddress = new RateLimiter(10, 60 * 60_000);

function writeSessionCookie(cookie: Record<string, { set: (options: Record<string, unknown>) => void; remove: () => void }>, request: Request, token: string | null, expires?: Date): void {
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
    secure: isHttps(request),
    expires,
  });
}

export const authPlugin = new Elysia({ prefix: "/auth/api" })
  // Marks requests arriving from a configured proxy, before any handler reads a forwarded header
  .onRequest(({ request, server }) => {
    const peer = server?.requestIP(request)?.address;
    if (peer && env.TRUSTED_PROXIES.includes(peer)) viaTrustedProxy.add(request);
  })
  .use(authContext)

  .get(
    "/me",
    async ({ principal }) => ({
      user: principal ? toUser(principal.user) : null,
      via: principal?.via ?? null,
      // What guards this account today, so the settings page and the sign-in screen agree
      factors: principal ? await secondFactors(principal.user) : [],
      needs_setup: await needsSetup(),
      // So the sign-in screen knows whether to offer "create an account"
      registration_enabled: (await serverPolicy()).registrationEnabled,
    }),
    {
      response: {
        200: t.Object({
          user: t.Nullable(UserSchema),
          via: t.Nullable(t.String()),
          factors: t.Array(t.UnionEnum(["totp", "passkey"])),
          needs_setup: t.Boolean(),
          registration_enabled: t.Boolean(),
        }),
      },
    },
  )

  .post(
    "/setup",
    async ({ body, cookie, request, server, status }) => {
      // Refused before the password is hashed: a finished setup mustn't be a free way to spend argon2 time
      if (!(await needsSetup())) return status(409, { error: "this server already has an account" });
      if (!accountsPerAddress.take(clientAddress(request, server))) return status(429, { error: "too many attempts — wait a while and try again" });
      // Only ever available on an empty install; afterwards accounts are made by an admin. The check and the insert
      // are one transaction, so a second request racing this one is refused rather than given its own admin.
      const user = await UserStore.insertFirstAdmin({
        username: body.username,
        displayName: body.display_name ?? null,
        passwordHash: await hashPassword(body.password),
        role: "admin",
      });
      if (!user) return status(409, { error: "this server already has an account" });
      const { token, expiresAt } = await startSession(user.id, request.headers.get("user-agent"));
      writeSessionCookie(cookie, request, token, expiresAt);
      log.info({ userId: user.id, username: user.username }, "First admin created");
      return toUser(user);
    },
    {
      body: t.Object({ username: Username, password: Password, display_name: t.Optional(t.Nullable(t.String({ maxLength: 80 }))) }),
      response: { 200: UserSchema, 409: ErrBody, 429: ErrBody },
    },
  )

  .post(
    "/register",
    async ({ body, cookie, request, server, status }) => {
      const policy = await serverPolicy();
      // Off by default: while it is off, accounts come from an admin
      if (!policy.registrationEnabled) return status(403, { error: "this server isn't taking new accounts" });
      if (await needsSetup()) return status(409, { error: "this server hasn't been set up yet" });
      if (!accountsPerAddress.take(clientAddress(request, server))) return status(429, { error: "too many new accounts from here — wait a while and try again" });
      if (await UserStore.findByUsername(body.username)) return status(409, { error: "that username is taken" });

      const user = await UserStore.insertIfFree({
        username: body.username,
        displayName: body.display_name ?? null,
        passwordHash: await hashPassword(body.password),
        role: policy.defaultRole,
      });
      // Taken between the check above and here
      if (!user) return status(409, { error: "that username is taken" });
      // A new account has no second factor yet; it can add one from its own page once it is in
      const { token, expiresAt } = await startSession(user.id, request.headers.get("user-agent"));
      writeSessionCookie(cookie, request, token, expiresAt);
      log.info({ userId: user.id, role: user.role }, "Account self-registered");
      return toUser(user);
    },
    {
      body: t.Object({ username: Username, password: Password, display_name: t.Optional(t.Nullable(t.String({ maxLength: 80 }))) }),
      response: { 200: UserSchema, 403: ErrBody, 409: ErrBody, 429: ErrBody },
    },
  )

  .post(
    "/login",
    async ({ body, cookie, request, server, status }) => {
      const address = clientAddress(request, server);
      // Keyed by address and name together, so a stranger's guesses can't lock the owner out from elsewhere
      const accountKey = `${address}|${normaliseUsername(body.username)}`;
      if (!loginsPerAddress.take(address) || !loginsPerAccount.take(accountKey)) {
        log.warn({ address, username: body.username }, "Sign-in attempts limited");
        return status(429, { error: "too many sign-in attempts — wait a few minutes and try again" });
      }
      const user = await authenticate(body.username, body.password);
      if (!user) {
        log.warn({ username: body.username }, "Failed sign-in");
        return status(401, { error: "wrong username or password" });
      }
      loginsPerAccount.reset(accountKey);
      // A second factor means no session yet: the password only buys a short-lived challenge
      const factors = await secondFactors(user);
      if (factors.length > 0) {
        const challenge = await startMfaChallenge(user.id, request.headers.get("user-agent"));
        return { user: null, mfa_required: true, methods: factors, challenge };
      }
      const { token, expiresAt } = await startSession(user.id, request.headers.get("user-agent"));
      writeSessionCookie(cookie, request, token, expiresAt);
      await UserStore.touch(user.id);
      return { user: toUser(user), mfa_required: false, methods: [], challenge: null };
    },
    {
      body: t.Object({ username: t.String({ maxLength: 40 }), password: t.String({ maxLength: 200 }) }),
      response: { 200: LoginResult, 401: ErrBody, 403: ErrBody, 429: ErrBody },
    },
  )

  .post(
    "/login/totp",
    async ({ body, cookie, request, status }) => {
      const pending = await pendingUser(body.challenge);
      if (!pending) return status(401, { error: "this sign-in has expired — start again" });
      if (!(await spendMfaAttempt(pending.tokenHash))) return status(401, { error: "too many wrong codes — sign in again" });
      if (!(await checkTotp(pending.user, body.code))) {
        log.warn({ userId: pending.user.id }, "Wrong authenticator code");
        return status(401, { error: "that code isn't right" });
      }
      // One challenge, one sign-in
      // Whoever spends the challenge gets the session; a second request holding the same one gets nothing
      if (!(await endMfaChallenge(pending.tokenHash))) return status(401, { error: "this sign-in has expired — start again" });
      const { token, expiresAt } = await startSession(pending.user.id, request.headers.get("user-agent"));
      writeSessionCookie(cookie, request, token, expiresAt);
      await UserStore.touch(pending.user.id);
      return { user: toUser(pending.user), mfa_required: false, methods: [], challenge: null };
    },
    {
      body: t.Object({ challenge: t.String({ maxLength: 200 }), code: t.String({ maxLength: 10 }) }),
      response: { 200: LoginResult, 401: ErrBody, 403: ErrBody },
    },
  )

  .post(
    "/login/recovery",
    async ({ body, cookie, request, status }) => {
      const pending = await pendingUser(body.challenge);
      if (!pending) return status(401, { error: "this sign-in has expired — start again" });
      if (!(await spendMfaAttempt(pending.tokenHash))) return status(401, { error: "too many wrong codes — sign in again" });
      if (!(await useRecoveryCode(pending.user.id, body.code))) {
        log.warn({ userId: pending.user.id }, "Wrong or spent recovery code");
        return status(401, { error: "that recovery code isn't right, or has been used" });
      }
      // Whoever spends the challenge gets the session; a second request holding the same one gets nothing
      if (!(await endMfaChallenge(pending.tokenHash))) return status(401, { error: "this sign-in has expired — start again" });
      const { token, expiresAt } = await startSession(pending.user.id, request.headers.get("user-agent"));
      writeSessionCookie(cookie, request, token, expiresAt);
      const left = (await RecoveryCodeStore.listUnused(pending.user.id)).length;
      log.info({ userId: pending.user.id, left }, "Signed in with a recovery code");
      return { user: toUser(pending.user), mfa_required: false, methods: [], challenge: null };
    },
    {
      body: t.Object({ challenge: t.String({ maxLength: 200 }), code: t.String({ maxLength: 40 }) }),
      response: { 200: LoginResult, 401: ErrBody, 403: ErrBody },
    },
  )

  // ── Passkeys at sign-in ────────────────────────────────────────────────────

  .post(
    "/login/passkey/options",
    async ({ body, status }) => {
      const pending = await pendingUser(body.challenge);
      if (!pending) return status(401, { error: "this sign-in has expired — start again" });
      const options = await authenticationOptions(pending.user);
      // The challenge the authenticator must sign, kept against this sign-in and nothing else
      await MfaChallengeStore.setWebauthnChallenge(pending.tokenHash, options.challenge);
      return options as unknown as Record<string, unknown>;
    },
    { body: t.Object({ challenge: t.String({ maxLength: 200 }) }), response: { 200: t.Any(), 401: ErrBody, 403: ErrBody } },
  )

  .post(
    "/login/passkey",
    async ({ body, cookie, request, status }) => {
      const pending = await pendingUser(body.challenge);
      if (!pending) return status(401, { error: "this sign-in has expired — start again" });
      if (!pending.webauthnChallenge) return status(409, { error: "ask for the passkey request first" });
      if (!(await verifyAssertion(pending.user, body.response as never, pending.webauthnChallenge))) {
        return status(401, { error: "that passkey didn't check out" });
      }
      // Whoever spends the challenge gets the session; a second request holding the same one gets nothing
      if (!(await endMfaChallenge(pending.tokenHash))) return status(401, { error: "this sign-in has expired — start again" });
      const { token, expiresAt } = await startSession(pending.user.id, request.headers.get("user-agent"));
      writeSessionCookie(cookie, request, token, expiresAt);
      await UserStore.touch(pending.user.id);
      return { user: toUser(pending.user), mfa_required: false, methods: [], challenge: null };
    },
    {
      body: t.Object({ challenge: t.String({ maxLength: 200 }), response: t.Any() }),
      response: { 200: LoginResult, 401: ErrBody, 403: ErrBody, 409: ErrBody },
    },
  )

  // ── Passkeys on the account page ───────────────────────────────────────────

  .get(
    "/passkeys",
    async ({ principal, status }) => {
      if (!principal) return status(401, { error: AUTH_FAILED });
      // A tool's key runs OCR; it must not be able to add a passkey, mint another key or list sessions
      if (principal.via !== "session") return status(403, { error: "this needs a signed-in browser, not an API key" });
      return (await CredentialStore.listByUser(principal.user.id)).map((credential) => ({
        id: credential.id,
        name: credential.name,
        last_used_at: credential.lastUsedAt,
        created_at: credential.createdAt,
      }));
    },
    { response: { 200: t.Array(PasskeySchema), 401: ErrBody, 403: ErrBody } },
  )

  .post(
    "/passkeys/options",
    async ({ principal, request, status }) => {
      // Enrolling always happens from a signed-in session: a passkey is a second factor, never a way in
      if (!principal) return status(401, { error: AUTH_FAILED });
      // A tool's key runs OCR; it must not be able to add a passkey, mint another key or list sessions
      if (principal.via !== "session") return status(403, { error: "this needs a signed-in browser, not an API key" });
      const options = await registrationOptions(principal.user);
      const token = await startMfaChallenge(principal.user.id, request.headers.get("user-agent"));
      await MfaChallengeStore.setWebauthnChallenge(hashSecret(token), options.challenge);
      return { challenge: token, options: options as unknown as Record<string, unknown> };
    },
    { response: { 200: t.Object({ challenge: t.String(), options: t.Any() }), 401: ErrBody, 403: ErrBody } },
  )

  .post(
    "/passkeys",
    async ({ principal, body, status }) => {
      if (!principal) return status(401, { error: AUTH_FAILED });
      // A tool's key runs OCR; it must not be able to add a passkey, mint another key or list sessions
      if (principal.via !== "session") return status(403, { error: "this needs a signed-in browser, not an API key" });
      const pending = await pendingUser(body.challenge);
      if (!pending || pending.user.id !== principal.user.id || !pending.webauthnChallenge) {
        return status(409, { error: "start the enrolment again" });
      }
      const credential = await saveRegistration(principal.user, body.name, body.response as never, pending.webauthnChallenge);
      // Enrolment, not a sign-in: the challenge is cleaned up either way, and the passkey is what matters
      await endMfaChallenge(pending.tokenHash);
      if (!credential) return status(422, { error: "that passkey couldn't be verified" });
      log.info({ userId: principal.user.id, credentialId: credential.id }, "Passkey registered");
      return { id: credential.id, name: credential.name, last_used_at: null, created_at: credential.createdAt };
    },
    {
      body: t.Object({ challenge: t.String({ maxLength: 200 }), name: t.String({ minLength: 1, maxLength: 60 }), response: t.Any() }),
      response: { 200: PasskeySchema, 401: ErrBody, 403: ErrBody, 409: ErrBody, 422: ErrBody },
    },
  )

  .delete(
    "/passkeys/:id",
    async ({ principal, params, body, status }) => {
      if (!principal) return status(401, { error: AUTH_FAILED });
      // A tool's key runs OCR; it must not be able to add a passkey, mint another key or list sessions
      if (principal.via !== "session") return status(403, { error: "this needs a signed-in browser, not an API key" });
      if (!(await verifyPassword(body.password, principal.user.passwordHash))) return status(403, { error: "the password doesn't match" });
      if (!(await CredentialStore.delete(params.id, principal.user.id))) return status(404, { error: "that passkey isn't on this account" });
      log.info({ userId: principal.user.id, credentialId: params.id }, "Passkey removed");
      return { removed: true };
    },
    {
      params: t.Object({ id: t.String({ maxLength: 400 }) }),
      body: t.Object({ password: t.String({ maxLength: 200 }) }),
      response: { 200: t.Object({ removed: t.Boolean() }), 401: ErrBody, 403: ErrBody, 404: ErrBody },
    },
  )

  // ── Authenticator apps: as many as the account wants ───────────────────────

  .get(
    "/totp",
    async ({ principal, status }) => {
      if (!principal) return status(401, { error: AUTH_FAILED });
      // A tool's key runs OCR; it must not be able to add a passkey, mint another key or list sessions
      if (principal.via !== "session") return status(403, { error: "this needs a signed-in browser, not an API key" });
      return (await TotpDeviceStore.listByUser(principal.user.id)).map((device) => ({
        id: device.id,
        name: device.name,
        confirmed: device.confirmedAt !== null,
        last_used_at: device.lastUsedAt,
        created_at: device.createdAt,
      }));
    },
    { response: { 200: t.Array(TotpDeviceSchema), 401: ErrBody, 403: ErrBody } },
  )

  .post(
    "/totp",
    async ({ principal, body, status }) => {
      if (!principal) return status(401, { error: AUTH_FAILED });
      // A tool's key runs OCR; it must not be able to add a passkey, mint another key or list sessions
      if (principal.via !== "session") return status(403, { error: "this needs a signed-in browser, not an API key" });
      const userId = principal.user.id;
      // Only one enrolment can be half-finished at a time; starting again replaces the abandoned one
      const secret = newTotpSecret();
      const device = await withAccountLock(userId, async () => {
        await TotpDeviceStore.deleteUnconfirmed(userId);
        return TotpDeviceStore.insert(userId, body.name, secret);
      });
      return { id: device.id, name: device.name, secret, uri: otpauthUri(secret, `${principal.user.username} (${body.name})`) };
    },
    {
      body: t.Object({ name: t.String({ minLength: 1, maxLength: 60 }) }),
      response: { 200: t.Object({ id: t.Integer(), name: t.String(), secret: t.String(), uri: t.String() }), 401: ErrBody, 403: ErrBody },
    },
  )

  .post(
    "/totp/:id/confirm",
    async ({ principal, params, body, status }) => {
      if (!principal) return status(401, { error: AUTH_FAILED });
      // A tool's key runs OCR; it must not be able to add a passkey, mint another key or list sessions
      if (principal.via !== "session") return status(403, { error: "this needs a signed-in browser, not an API key" });
      const userId = principal.user.id;
      // Read, decide and write as one step per account: two confirmations at once must not both count as the first
      return withAccountLock(userId, async () => {
        const device = await TotpDeviceStore.findById(params.id);
        if (!device || device.userId !== userId) return status(404, { error: "that authenticator isn't on this account" });
        if (device.confirmedAt) return status(409, { error: "this authenticator is already set up" });
        if (!verifyTotp(device.secret, body.code)) return status(422, { error: "that code isn't right — check the app's clock" });

        const first = (await TotpDeviceStore.listConfirmed(userId)).length === 0;
        await TotpDeviceStore.confirm(device.id);
        // Recovery codes come with the first device; the rest join an account that already has them
        const codes = first ? await issueRecoveryCodes(userId) : [];
        log.info({ userId, deviceId: device.id, first }, "Authenticator enrolled");
        return { confirmed: true, recovery_codes: codes };
      });
    },
    {
      params: t.Object({ id: t.Integer({ minimum: 1 }) }),
      body: t.Object({ code: t.String({ maxLength: 10 }) }),
      response: { 200: t.Object({ confirmed: t.Boolean(), recovery_codes: t.Array(t.String()) }), 401: ErrBody, 403: ErrBody, 404: ErrBody, 409: ErrBody, 422: ErrBody },
    },
  )

  .delete(
    "/totp/:id",
    async ({ principal, params, body, status }) => {
      if (!principal) return status(401, { error: AUTH_FAILED });
      // A tool's key runs OCR; it must not be able to add a passkey, mint another key or list sessions
      if (principal.via !== "session") return status(403, { error: "this needs a signed-in browser, not an API key" });
      // The password again: a borrowed session shouldn't be able to strip a factor off the account
      if (!(await verifyPassword(body.password, principal.user.passwordHash))) return status(403, { error: "the password doesn't match" });
      const userId = principal.user.id;
      if (!(await withAccountLock(userId, () => removeTotpDevice(userId, params.id)))) return status(404, { error: "that authenticator isn't on this account" });
      log.info({ userId: principal.user.id, deviceId: params.id }, "Authenticator removed");
      return { removed: true };
    },
    {
      params: t.Object({ id: t.Integer({ minimum: 1 }) }),
      body: t.Object({ password: t.String({ maxLength: 200 }) }),
      response: { 200: t.Object({ removed: t.Boolean() }), 401: ErrBody, 403: ErrBody, 404: ErrBody },
    },
  )

  .post(
    "/logout",
    async ({ cookie, request }) => {
      const token = cookie[SESSION_COOKIE]?.value;
      if (typeof token === "string" && token) await endSession(token);
      writeSessionCookie(cookie, request, null);
      return { signed_out: true };
    },
    { response: { 200: t.Object({ signed_out: t.Boolean() }) } },
  )

  .post(
    "/password",
    async ({ principal, body, cookie, request, status }) => {
      if (!principal) return status(401, { error: AUTH_FAILED });
      // A tool's key runs OCR; it must not be able to add a passkey, mint another key or list sessions
      if (principal.via !== "session") return status(403, { error: "this needs a signed-in browser, not an API key" });
      if (!(await verifyPassword(body.current, principal.user.passwordHash))) return status(403, { error: "the current password doesn't match" });
      await UserStore.update(principal.user.id, { passwordHash: await hashPassword(body.next) });
      // Every session goes, including this one: a password change signs the account out everywhere
      await SessionStore.deleteForUser(principal.user.id);
      const { token, expiresAt } = await startSession(principal.user.id, request.headers.get("user-agent"));
      writeSessionCookie(cookie, request, token, expiresAt);
      log.info({ userId: principal.user.id }, "Password changed");
      return { changed: true };
    },
    {
      body: t.Object({ current: t.String({ maxLength: 200 }), next: Password }),
      response: { 200: t.Object({ changed: t.Boolean() }), 401: ErrBody, 403: ErrBody },
    },
  )

  .post(
    "/recovery",
    async ({ principal, body, status }) => {
      if (!principal) return status(401, { error: AUTH_FAILED });
      // A tool's key runs OCR; it must not be able to add a passkey, mint another key or list sessions
      if (principal.via !== "session") return status(403, { error: "this needs a signed-in browser, not an API key" });
      if (!(await verifyPassword(body.password, principal.user.passwordHash))) return status(403, { error: "the password doesn't match" });
      const codes = await issueRecoveryCodes(principal.user.id);
      log.info({ userId: principal.user.id }, "Recovery codes reissued");
      return { recovery_codes: codes };
    },
    {
      body: t.Object({ password: t.String({ maxLength: 200 }) }),
      response: { 200: t.Object({ recovery_codes: t.Array(t.String()) }), 401: ErrBody, 403: ErrBody },
    },
  )

  // ── Where this account is signed in ───────────────────────────────────────

  .get(
    "/sessions",
    async ({ principal, cookie, status }) => {
      if (!principal) return status(401, { error: AUTH_FAILED });
      // A tool's key runs OCR; it must not be able to add a passkey, mint another key or list sessions
      if (principal.via !== "session") return status(403, { error: "this needs a signed-in browser, not an API key" });
      const token = cookie[SESSION_COOKIE]?.value;
      const currentHash = typeof token === "string" && token ? hashSecret(token) : null;
      return (await SessionStore.listByUser(principal.user.id)).map((session) => ({
        // The stored hash, not the cookie: it identifies a session without being usable as one
        id: session.tokenHash,
        current: session.tokenHash === currentHash,
        user_agent: session.userAgent,
        last_seen_at: session.lastSeenAt,
        created_at: session.createdAt,
        expires_at: session.expiresAt,
      }));
    },
    { response: { 200: t.Array(SessionSchema), 401: ErrBody, 403: ErrBody } },
  )

  .delete(
    "/sessions/:id",
    async ({ principal, params, status }) => {
      if (!principal) return status(401, { error: AUTH_FAILED });
      // A tool's key runs OCR; it must not be able to add a passkey, mint another key or list sessions
      if (principal.via !== "session") return status(403, { error: "this needs a signed-in browser, not an API key" });
      const session = await SessionStore.find(params.id);
      if (!session || session.userId !== principal.user.id) return status(404, { error: "no such session" });
      await SessionStore.delete(params.id);
      return { signed_out: true };
    },
    {
      params: t.Object({ id: t.String({ maxLength: 128 }) }),
      response: { 200: t.Object({ signed_out: t.Boolean() }), 401: ErrBody, 403: ErrBody, 404: ErrBody },
    },
  )

  // ── API keys, for the extension and the desktop app ────────────────────────

  .get(
    "/keys",
    async ({ principal, status }) => {
      if (!principal) return status(401, { error: AUTH_FAILED });
      // A tool's key runs OCR; it must not be able to add a passkey, mint another key or list sessions
      if (principal.via !== "session") return status(403, { error: "this needs a signed-in browser, not an API key" });
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
    { response: { 200: t.Array(ApiKeySchema), 401: ErrBody, 403: ErrBody } },
  )

  .post(
    "/keys",
    async ({ principal, body, status }) => {
      if (!principal) return status(401, { error: AUTH_FAILED });
      // A tool's key runs OCR; it must not be able to add a passkey, mint another key or list sessions
      if (principal.via !== "session") return status(403, { error: "this needs a signed-in browser, not an API key" });
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
      if (!principal) return status(401, { error: AUTH_FAILED });
      // A tool's key runs OCR; it must not be able to add a passkey, mint another key or list sessions
      if (principal.via !== "session") return status(403, { error: "this needs a signed-in browser, not an API key" });
      const key = await ApiKeyStore.findById(params.id);
      if (!key || key.userId !== principal.user.id) return status(404, { error: "key not found" });
      await ApiKeyStore.revoke(params.id);
      return { revoked: true };
    },
    {
      params: t.Object({ id: t.Integer({ minimum: 1 }) }),
      response: { 200: t.Object({ revoked: t.Boolean() }), 401: ErrBody, 403: ErrBody, 404: ErrBody },
    },
  );
