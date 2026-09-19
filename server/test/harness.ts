/**
 * The app as the tests see it, and small helpers for talking to it as somebody.
 *
 * Requests go through `app.handle()` — no port, no running server — with the same guard and plugins, in the same
 * order, as `src/index.ts`.
 */
import { Elysia } from "elysia";
import { authGuard } from "@/plugins/auth/guard";
import { authPlugin } from "@/plugins/auth/index";
import { managePlugin } from "@/plugins/manage/index";
import { readPlugin } from "@/plugins/read/index";
import { studioPlugin } from "@/plugins/studio/index";
import { routeTools } from "@/plugins/route-tools";
import { SESSION_COOKIE } from "@/services/auth";
import { UserStore } from "@/stores/user-store";
import { hashPassword } from "@/services/auth";
import type { UserRole } from "@/db/schema";

export const app = new Elysia().use(authGuard).use(authPlugin).use(readPlugin).use(managePlugin).use(studioPlugin).use(routeTools);

export interface As {
  cookie?: string;
  key?: string;
}

export interface Reply<T = unknown> {
  status: number;
  body: T;
  setCookie: string;
}

/** A JSON request, as nobody, as a signed-in browser (`cookie`) or as a tool (`key`). */
export async function call<T = any>(method: string, path: string, body?: unknown, as: As = {}): Promise<Reply<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData)) headers["content-type"] = "application/json";
  if (as.cookie) headers.cookie = `${SESSION_COOKIE}=${as.cookie}`;
  if (as.key) headers["x-api-key"] = as.key;
  const res = await app.handle(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  }));
  const type = res.headers.get("content-type") ?? "";
  return {
    status: res.status,
    body: (type.includes("json") ? await res.json() : null) as T,
    setCookie: res.headers.get("set-cookie") ?? "",
  };
}

const tokenFrom = (setCookie: string): string => new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(setCookie)?.[1] ?? "";

let counter = 0;

/**
 * A fresh account of the given role, signed in. Names are unique per call, so test files sharing one database never
 * collide.
 */
export async function signedIn(role: UserRole = "contributor"): Promise<{ id: number; username: string; cookie: string }> {
  const username = `${role}-${process.pid}-${++counter}`;
  const password = "a long enough password";
  const user = await UserStore.insert({ username, passwordHash: await hashPassword(password), role });
  const login = await call("POST", "/auth/api/login", { username, password });
  return { id: user.id, username, cookie: tokenFrom(login.setCookie) };
}

/** A small valid PNG of one colour, for uploads. */
export async function png(colour = "#3366cc", width = 24, height = 32): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: colour } }).png().toBuffer());
}
