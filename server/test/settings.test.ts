/**
 * What the server tells a client it can do. The extension reads this before it imports a chapter, so the flag is a
 * contract: dropping it silently would make an up-to-date extension refuse to import.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { loadRuntimeSettings, runtimeSettings } from "@/stores/settings-store";
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

describe("choosing an engine", () => {
  const before = { ...runtimeSettings };
  afterAll(async () => {
    await call("PATCH", "/api/settings/engine", { engine: before.preferredTranslationEngine }, { cookie: (await signedIn("admin")).cookie });
    Object.assign(runtimeSettings, before);
  });

  test("is remembered, so a restart doesn't undo it", async () => {
    const { cookie } = await signedIn("admin");
    const changed = await call("PATCH", "/api/settings/engine", { engine: "local" }, { cookie });
    expect(changed.status).toBe(200);
    expect(runtimeSettings.preferredTranslationEngine).toBe("local");

    // As a restart reads it back
    runtimeSettings.preferredTranslationEngine = "auto";
    await loadRuntimeSettings();
    const remembered: string = runtimeSettings.preferredTranslationEngine;
    expect(remembered).toBe("local");
  });

  test("is an admin's to change, though anyone may read the settings", async () => {
    const { cookie } = await signedIn("contributor");
    const refused = await call("PATCH", "/api/settings/engine", { engine: "deepl" }, { cookie });
    expect(refused.status).toBe(403);
    const inpaint = await call("PATCH", "/api/settings/inpaint-engine", { engine: "lama" }, { cookie });
    expect(inpaint.status).toBe(403);
    // …and the engine is unchanged by the attempt
    const unchanged: string = runtimeSettings.preferredTranslationEngine;
    expect(unchanged).toBe("local");
    expect((await call("GET", "/api/settings", undefined, { cookie })).status).toBe(200);
  });

  test("refuses an engine that isn't one", async () => {
    const { cookie } = await signedIn("admin");
    const refused = await call("PATCH", "/api/settings/engine", { engine: "google" }, { cookie });
    expect(refused.status).toBe(400);
    const unchanged: string = runtimeSettings.preferredTranslationEngine;
    expect(unchanged).toBe("local");
  });
});
