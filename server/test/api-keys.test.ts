/**
 * The life of an API key: made once, stopped when it is no longer wanted, and forgotten only when somebody says so.
 *
 * The two steps are deliberately separate. Revoking is what makes a key stop working, and the row it leaves behind
 * is the only record of what that key was and when anything last used it — which is exactly what you want if you
 * ever suspect one has leaked. Deleting is the decision to give that record up, and it is refused while the key
 * still works: a row vanishing from the list while the extension holding it carried on would be the worst of both,
 * a tool that stops later with nothing left to explain why.
 */
import { describe, expect, test } from "bun:test";
import { userForApiKey } from "@/services/auth";
import { ApiKeyStore } from "@/stores/user-store";
import { call, signedIn } from "./harness";

interface Listed {
  id: number;
  name: string;
  revoked: boolean;
}

/** An account with one key, and the key itself — which is readable only at this moment. */
async function withKey(name = "extension"): Promise<{ cookie: string; id: number; key: string }> {
  const owner = await signedIn("contributor");
  const made = await call<{ id: number; key: string }>("POST", "/auth/api/keys", { name }, { cookie: owner.cookie });
  return { cookie: owner.cookie, id: made.body.id, key: made.body.key };
}

const listed = async (cookie: string): Promise<Listed[]> =>
  (await call<Listed[]>("GET", "/auth/api/keys", undefined, { cookie })).body;

describe("revoking", () => {
  test("stops the key working, and says so in the list", async () => {
    const { cookie, id, key } = await withKey();
    expect(await userForApiKey(key)).not.toBeNull();

    const revoked = await call("POST", `/auth/api/keys/${id}/revoke`, {}, { cookie });
    expect(revoked.status).toBe(200);
    expect(revoked.body).toEqual({ revoked: true });

    expect(await userForApiKey(key)).toBeNull();
    expect((await listed(cookie)).find((row) => row.id === id)?.revoked).toBe(true);
  });

  test("keeps the record, which is the whole point of not deleting it", async () => {
    const { cookie, id } = await withKey("the one that leaked");
    await call("POST", `/auth/api/keys/${id}/revoke`, {}, { cookie });

    const row = (await listed(cookie)).find((entry) => entry.id === id);
    expect(row).toBeDefined();
    expect(row?.name).toBe("the one that leaked");
  });

  test("twice is not an error, and the second time changes nothing", async () => {
    const { cookie, id } = await withKey();
    expect((await call("POST", `/auth/api/keys/${id}/revoke`, {}, { cookie })).status).toBe(200);
    expect((await call("POST", `/auth/api/keys/${id}/revoke`, {}, { cookie })).status).toBe(200);
    expect((await listed(cookie)).filter((row) => row.id === id)).toHaveLength(1);
  });
});

describe("removing the record", () => {
  test("is refused while the key still works, and the key still works afterwards", async () => {
    const { cookie, id, key } = await withKey();

    const refused = await call<{ error: string }>("DELETE", `/auth/api/keys/${id}`, undefined, { cookie });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("revoke this key before removing it");

    // Nothing was half-done: the key is still there and still opens the door.
    expect(await userForApiKey(key)).not.toBeNull();
    expect((await listed(cookie)).some((row) => row.id === id)).toBe(true);
  });

  test("works once the key has been revoked", async () => {
    const { cookie, id, key } = await withKey();
    await call("POST", `/auth/api/keys/${id}/revoke`, {}, { cookie });

    const removed = await call("DELETE", `/auth/api/keys/${id}`, undefined, { cookie });
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ deleted: true });

    expect((await listed(cookie)).some((row) => row.id === id)).toBe(false);
    expect(await ApiKeyStore.findById(id)).toBeUndefined();
    // And it certainly does not come back to life by having its row removed.
    expect(await userForApiKey(key)).toBeNull();
  });

  test("a key already gone is not found rather than deleted twice", async () => {
    const { cookie, id } = await withKey();
    await call("POST", `/auth/api/keys/${id}/revoke`, {}, { cookie });
    await call("DELETE", `/auth/api/keys/${id}`, undefined, { cookie });

    expect((await call("DELETE", `/auth/api/keys/${id}`, undefined, { cookie })).status).toBe(404);
  });
});

describe("whose key it is", () => {
  test("somebody else's is not theirs to revoke or remove", async () => {
    const mine = await withKey();
    const stranger = await signedIn("contributor");

    expect((await call("POST", `/auth/api/keys/${mine.id}/revoke`, {}, { cookie: stranger.cookie })).status).toBe(404);
    expect((await call("DELETE", `/auth/api/keys/${mine.id}`, undefined, { cookie: stranger.cookie })).status).toBe(404);

    // Untouched by the attempt.
    expect(await userForApiKey(mine.key)).not.toBeNull();
  });

  test("a key cannot revoke or remove a key — that needs a signed-in browser", async () => {
    const { cookie, id, key } = await withKey();
    const second = await call<{ id: number }>("POST", "/auth/api/keys", { name: "another" }, { cookie });

    expect((await call("POST", `/auth/api/keys/${id}/revoke`, {}, { key })).status).toBe(403);
    expect((await call("DELETE", `/auth/api/keys/${second.body.id}`, undefined, { key })).status).toBe(403);
    expect(await userForApiKey(key)).not.toBeNull();
  });

  test("and nobody at all gets neither", async () => {
    const { id } = await withKey();
    expect((await call("POST", `/auth/api/keys/${id}/revoke`, {})).status).toBe(401);
    expect((await call("DELETE", `/auth/api/keys/${id}`)).status).toBe(401);
  });
});
