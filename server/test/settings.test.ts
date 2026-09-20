/**
 * What the server tells a client it can do. The extension reads this before it imports a chapter, so the flag is a
 * contract: dropping it silently would make an up-to-date extension refuse to import.
 */
import { describe, expect, test } from "bun:test";
import { call, signedIn } from "./harness";

describe("GET /api/settings", () => {
  test("reports the workspaces capability", async () => {
    const { cookie } = await signedIn("contributor");
    const settings = await call<{ capabilities: { workspaces: boolean } }>("GET", "/api/settings", undefined, { cookie });
    expect(settings.status).toBe(200);
    // Without it the popup says to update the server, rather than failing halfway through an import
    expect(settings.body.capabilities).toEqual({ workspaces: true });
  });
});
