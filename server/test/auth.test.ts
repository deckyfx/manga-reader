/**
 * The auth boundary: what each kind of caller may reach. These are the invariants that went wrong at least once
 * while phase 5.4 was built, kept here so they can't quietly go wrong again.
 */
import { describe, expect, test } from "bun:test";
import { policyFor } from "@/plugins/auth/guard";
import { call, signedIn } from "./harness";

describe("the policy table", () => {
  test("reading and signing in are open", () => {
    expect(policyFor("/read/api/series")).toBe("public");
    expect(policyFor("/auth/api/login")).toBe("public");
    expect(policyFor("/health")).toBe("public");
  });

  test("the library, the Studio and the tools need a contributor", () => {
    expect(policyFor("/manage/api/series")).toBe("contributor");
    expect(policyFor("/studio/api/pages")).toBe("contributor");
    expect(policyFor("/ocr")).toBe("contributor");
  });

  test("accounts need an admin, and anything unlisted fails closed", () => {
    expect(policyFor("/manage/api/users")).toBe("admin");
    expect(policyFor("/some/route/nobody/listed")).toBe("admin");
    expect(policyFor("/read/apizzz")).toBe("admin");
  });
});

describe("who may reach what", () => {
  test("a guest may read but not manage", async () => {
    expect((await call("GET", "/read/api/series")).status).toBe(200);
    const refused = await call("GET", "/studio/api/pages");
    expect(refused.status).toBe(401);
    expect(refused.body.error).toBe("Authorization failed");
  });

  test("a reader may not open the Studio; a contributor may", async () => {
    const reader = await signedIn("reader");
    const contributor = await signedIn("contributor");
    expect((await call("GET", "/studio/api/pages", undefined, { cookie: reader.cookie })).status).toBe(403);
    expect((await call("GET", "/studio/api/pages", undefined, { cookie: contributor.cookie })).status).toBe(200);
  });

  test("an API key runs the tools but can't manage credentials", async () => {
    const contributor = await signedIn("contributor");
    const key = (await call("POST", "/auth/api/keys", { name: "extension" }, { cookie: contributor.cookie })).body.key as string;
    expect((await call("GET", "/api/whoami", undefined, { key })).status).toBe(200);
    expect((await call("POST", "/auth/api/keys", { name: "another" }, { key })).status).toBe(403);
    expect((await call("GET", "/auth/api/sessions", undefined, { key })).status).toBe(403);
  });

  test("an admin's key is still only a key", async () => {
    const admin = await signedIn("admin");
    const key = (await call("POST", "/auth/api/keys", { name: "admin tool" }, { cookie: admin.cookie })).body.key as string;
    expect((await call("GET", "/manage/api/users", undefined, { key })).status).toBe(403);
    expect((await call("GET", "/manage/api/users", undefined, { cookie: admin.cookie })).status).toBe(200);
  });
});
