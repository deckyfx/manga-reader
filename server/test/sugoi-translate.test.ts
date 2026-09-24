/**
 * Translating through a Sugoi server of one's own: which engine a request lands on, and that what reaches a Sugoi
 * server is the protocol its own clients speak (see tools/sugoi/).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { inferenceHandlers, inferenceQueue } from "@/queue/inference-queue";
import { registerTranslateHandler } from "@/services/translate-service";
import { resolveTranslationEngine } from "@/services/translation-engine";
import { runtimeSettings, setRuntimeEngine } from "@/stores/settings-store";

/** Puts the translation settings back however a test left them. */
function settings(config: { sugoi?: string; deepl?: string; preferred?: typeof runtimeSettings.preferredTranslationEngine }): void {
  Bun.env.SUGOI_URL = config.sugoi ?? "";
  Bun.env.DEEPL_API_KEY = config.deepl ?? "";
  runtimeSettings.preferredTranslationEngine = config.preferred ?? "auto";
}
const before = { sugoi: Bun.env.SUGOI_URL, deepl: Bun.env.DEEPL_API_KEY, preferred: runtimeSettings.preferredTranslationEngine };
afterAll(() => {
  // Assigning undefined would leave the string "undefined" behind, which reads as a configured engine
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete Bun.env[name];
    else Bun.env[name] = value;
  };
  restore("SUGOI_URL", before.sugoi);
  restore("DEEPL_API_KEY", before.deepl);
  runtimeSettings.preferredTranslationEngine = before.preferred;
});

describe("which engine translates", () => {
  test("nothing configured leaves the built-in model", () => {
    settings({});
    expect(resolveTranslationEngine()).toBe("local");
    expect(resolveTranslationEngine("sugoi")).toBe("local");
    expect(resolveTranslationEngine("deepl")).toBe("local");
  });

  test("a Sugoi server is what auto reaches for, ahead of DeepL", () => {
    settings({ sugoi: "http://127.0.0.1:14366", deepl: "key:fx" });
    expect(resolveTranslationEngine()).toBe("sugoi");
    expect(resolveTranslationEngine("auto")).toBe("sugoi");
    expect(resolveTranslationEngine("deepl")).toBe("deepl");
    expect(resolveTranslationEngine("local")).toBe("local");
  });

  test("the runtime setting decides when the request doesn't", () => {
    settings({ sugoi: "http://127.0.0.1:14366", deepl: "key:fx", preferred: "deepl" });
    expect(resolveTranslationEngine()).toBe("deepl");
    settings({ sugoi: "http://127.0.0.1:14366", deepl: "key:fx", preferred: "local" });
    expect(resolveTranslationEngine()).toBe("local");
    // Asked for by name, even against the setting
    expect(resolveTranslationEngine("sugoi")).toBe("sugoi");
  });
});

describe("changing the engine", () => {
  test("an engine that belongs to the other setting changes nothing", async () => {
    const was = runtimeSettings.preferredTranslationEngine;
    await expect(setRuntimeEngine("translation", "lama")).rejects.toThrow(/not one of/);
    expect(runtimeSettings.preferredTranslationEngine).toBe(was);
  });
});

describe("talking to a Sugoi server", () => {
  test("sends the Sugoi protocol and returns what it answers", async () => {
    let seen: unknown;
    const stub = Bun.serve({
      port: 0,
      async fetch(request) {
        seen = await request.json();
        return Response.json("You're already dead");
      },
    });
    try {
      settings({ sugoi: stub.url.href });
      registerTranslateHandler();
      const result = await inferenceQueue.enqueue<{ text: string; engine: string }, { translatedText: string; engine: string }>(
        "translate",
        { text: "お前はもう死んでいる", engine: "sugoi" },
      );
      expect(seen).toEqual({ content: "お前はもう死んでいる", message: "translate sentences" });
      expect(result.translatedText).toBe("You're already dead");
      expect(result.engine).toBe("sugoi");
    } finally {
      stub.stop(true);
    }
  });

  test("a server that answers something else is an error, not a mistranslation", async () => {
    const stub = Bun.serve({ port: 0, fetch: () => Response.json({ unexpected: true }) });
    try {
      settings({ sugoi: stub.url.href });
      registerTranslateHandler();
      const attempt = inferenceQueue.enqueue("translate", { text: "テスト", engine: "sugoi" });
      await expect(attempt).rejects.toThrow(/shape/);
    } finally {
      stub.stop(true);
    }
  });
});

describe("giving up", () => {
  test("a cancelled job stops waiting on the translator", async () => {
    // A server that never answers: without the job's own signal this would hold on until the request's own timeout,
    // long after whoever asked had gone
    const stub = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
    try {
      settings({ sugoi: stub.url.href });
      registerTranslateHandler();
      const giveUp = new AbortController();
      const attempt = inferenceHandlers.translate({ text: "一" }, giveUp.signal);
      giveUp.abort();
      await expect(attempt).rejects.toThrow();
    } finally {
      stub.stop(true);
    }
  });
});
