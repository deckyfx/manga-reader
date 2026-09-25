/**
 * What the desktop app is entitled to expect from this server.
 *
 * The desktop is C#: its request and response shapes live in desktop/Models/ServerModels.cs and are checked by its
 * own compiler against nothing at all. When /health's `version` turned from a string into an object, the desktop's
 * Test Connection began failing with a JsonException and nobody noticed for a fortnight. These tests pin the parts
 * of the contract that app depends on, so the next such change breaks here first — where the message says what to
 * go and edit.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { authGuard } from "@/plugins/auth/guard";
import { authPlugin } from "@/plugins/auth/index";
import { routeAnalyze } from "@/plugins/route-analyze";
import { routeHealth } from "@/plugins/route-health";
import { routeOcr } from "@/plugins/route-ocr";
import { routeTools } from "@/plugins/route-tools";
import { SESSION_COOKIE } from "@/services/auth";
import { bootState } from "@/boot-state";
import { runtimeSettings } from "@/stores/settings-store";
import { call as harnessCall, signedIn } from "./harness";

/** The routes the desktop talks to, mounted the way src/index.ts mounts them. */
const app = new Elysia()
  .use(authGuard)
  .use(authPlugin)
  .use(routeTools)
  .use(routeHealth)
  .use(routeOcr)
  .use(routeAnalyze);

async function ask(
  method: string,
  path: string,
  body?: unknown,
  as: { key?: string; cookie?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (as.key) headers["x-api-key"] = as.key;
  if (as.cookie) headers.cookie = `${SESSION_COOKIE}=${as.cookie}`;
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, body: type.includes("json") ? await res.json() : null };
}

/** A contributor's API key, which is what the desktop app holds. */
async function contributorKey(): Promise<string> {
  const contributor = await signedIn("contributor");
  const made = await harnessCall("POST", "/auth/api/keys", { name: "desktop" }, { cookie: contributor.cookie });
  return made.body.key as string;
}

describe("/health, which the desktop reads on Test Connection", () => {
  test("version is an object of strings — HealthResponse.Version is VersionInfo, not a string", async () => {
    const { status, body } = await ask("GET", "/health");
    expect(status).toBe(200);
    expect(typeof body.version).toBe("object");
    expect(typeof body.version.server).toBe("string");
    expect(typeof body.version.bun).toBe("string");
    expect(typeof body.version.started_at).toBe("string");
  });

  test("readiness is reported per part, each true/false or the string \"disabled\"", async () => {
    const { body } = await ask("GET", "/health");
    expect(["starting", "ready", "degraded"]).toContain(body.status);
    for (const part of ["ocr", "translate", "dictionary"]) expect(typeof body[part]).toBe("boolean");
    for (const part of ["inpaint", "bubble", "text_seg"]) {
      const value = body[part];
      expect(typeof value === "boolean" || value === "disabled").toBe(true);
    }
    expect(typeof body.downloads).toBe("object");
  });

  test("it answers without a key, which is why it can't be the whole of Test Connection", async () => {
    expect((await ask("GET", "/health")).status).toBe(200);
  });
});

describe("/api/whoami, which is how the desktop tells a good key from a bad one", () => {
  test("a contributor's key gets username, role and via", async () => {
    const key = await contributorKey();
    const { status, body } = await ask("GET", "/api/whoami", undefined, { key });
    expect(status).toBe(200);
    expect(typeof body.username).toBe("string");
    expect(body.role).toBe("contributor");
    expect(typeof body.via).toBe("string");
  });

  test("no key and a wrong key are both refused, with a reason in `error`", async () => {
    const none = await ask("GET", "/api/whoami");
    expect(none.status).toBe(401);
    expect(typeof none.body.error).toBe("string");
    expect((await ask("GET", "/api/whoami", undefined, { key: "wo_not-a-real-key" })).status).toBe(401);
  });
});

describe("/ocr, as the desktop sends it", () => {
  /** Exactly what desktop/Models/ServerModels.cs OcrRequest serialises to. */
  const desktopBody = { image: "aGVsbG8=", translate: true };

  test("the body is accepted — refused for the model, not for its shape", async () => {
    const key = await contributorKey();
    const { status, body } = await ask("POST", "/ocr", desktopBody, { key });
    // 422 would mean the schema rejected the desktop's JSON. In tests no model is loaded, so the honest answer is
    // 503 — which is the desktop's IsNotReady, shown as the server's own words.
    expect(status).not.toBe(422);
    expect(status).toBe(503);
    expect(typeof body.error).toBe("string");
  });

  test("without a key it is 401, which the desktop explains rather than passing on", async () => {
    const { status, body } = await ask("POST", "/ocr", desktopBody);
    expect(status).toBe(401);
    expect(typeof body.error).toBe("string");
  });

  /**
   * That the body is *accepted* proves little: a field the schema does not know is tolerated rather than refused,
   * so deleting `translate` from the route would leave these requests passing and translations quietly gone. This
   * asks for something only a server that read the flag can answer.
   *
   * Readiness is arranged so no work and no network happen: OCR is marked ready, the engine is pinned to the
   * built-in one (a stored DEEPL_API_KEY must not turn this into a real request), and that model is *not* ready —
   * so the handler refuses on the translation before it reaches any inference.
   */
  test("`translate: true` makes the server want a translation, not merely accept the word", async () => {
    const key = await contributorKey();
    const wasOcrReady = bootState.ocrReady;
    const wasEngine = runtimeSettings.preferredTranslationEngine;
    bootState.ocrReady = true;
    runtimeSettings.preferredTranslationEngine = "local";
    try {
      const asked = await ask("POST", "/ocr", { image: "aGVsbG8=", translate: true }, { key });
      expect(asked.status).toBe(503);
      expect(asked.body.error).toBe("Translate model not ready");
    } finally {
      bootState.ocrReady = wasOcrReady;
      runtimeSettings.preferredTranslationEngine = wasEngine;
    }
  });

  test("the engine name older clients sent still means yes", async () => {
    const key = await contributorKey();
    const wasOcrReady = bootState.ocrReady;
    const wasEngine = runtimeSettings.preferredTranslationEngine;
    bootState.ocrReady = true;
    runtimeSettings.preferredTranslationEngine = "local";
    try {
      const legacy = await ask("POST", "/ocr", { image: "aGVsbG8=", translate_engine: "local" }, { key });
      expect(legacy.status).toBe(503);
      expect(legacy.body.error).toBe("Translate model not ready");
    } finally {
      bootState.ocrReady = wasOcrReady;
      runtimeSettings.preferredTranslationEngine = wasEngine;
    }
  });
});

describe("/analyze, as the desktop sends it", () => {
  test("text, sanitize and mode are accepted together", async () => {
    const key = await contributorKey();
    const { status } = await ask("POST", "/analyze", { text: "テスト", sanitize: true, mode: "local" }, { key });
    expect(status).not.toBe(422);
  });
});

// Nothing here is allowed to leave the shared state changed for whatever runs next.
afterAll(() => {
  bootState.ocrReady = false;
});
