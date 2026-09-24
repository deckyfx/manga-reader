/**
 * Translating through a Sugoi server of one's own: which engine a request lands on, and that what reaches a Sugoi
 * server is the protocol its own clients speak (see tools/sugoi/).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { bootState } from "@/boot-state";
import { inferenceHandlers, inferenceQueue } from "@/queue/inference-queue";
import { enginesNotReady } from "@/services/page-engines";
import { registerTranslateHandler, translationBatchSize } from "@/services/translate-service";
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

describe("being ready to work on pages", () => {
  test("a server translating elsewhere doesn't wait for a model it never loads", () => {
    const wasOcr = bootState.ocrReady;
    const wasTranslate = bootState.translateReady;
    try {
      bootState.ocrReady = true;
      bootState.translateReady = false;
      // Nothing configured: the built-in model is the only translator, so it does have to be loaded
      settings({});
      expect(enginesNotReady()).toMatch(/still loading/);
      // …but a Sugoi server is somebody else's process, and it is ready whatever this one loaded
      settings({ sugoi: "http://127.0.0.1:14366" });
      expect(enginesNotReady()).toBeNull();
      // OCR is this server's own work either way
      bootState.ocrReady = false;
      expect(enginesNotReady()).toMatch(/still loading/);
    } finally {
      bootState.ocrReady = wasOcr;
      bootState.translateReady = wasTranslate;
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

describe("translating a page's blocks together", () => {
  test("sends them in one request and keeps their order", async () => {
    const asked: unknown[] = [];
    const stub = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = await request.json() as { content: string | string[] };
        asked.push(body.content);
        const texts = Array.isArray(body.content) ? body.content : [body.content];
        return Response.json(texts.map((t) => `[${t}]`));
      },
    });
    try {
      settings({ sugoi: stub.url.href });
      registerTranslateHandler();
      const result = await inferenceQueue.enqueue<{ texts: string[] }, { translations: string[]; engine: string }>(
        "translate",
        { texts: ["一", "二", "三"] },
      );
      // One round trip for the three of them, which is the whole point: the waiting is what costs
      expect(asked).toEqual([["一", "二", "三"]]);
      expect(result.translations).toEqual(["[一]", "[二]", "[三]"]);
    } finally {
      stub.stop(true);
    }
  });

  test("a server that answers with the wrong number is an error, not a shuffle", async () => {
    const stub = Bun.serve({ port: 0, fetch: () => Response.json(["only one"]) });
    try {
      settings({ sugoi: stub.url.href });
      registerTranslateHandler();
      // Position is all that ties a translation to its block, so a short answer must not be spread over them
      await expect(inferenceQueue.enqueue("translate", { texts: ["一", "二"] })).rejects.toThrow(/1 translations for 2/);
    } finally {
      stub.stop(true);
    }
  });

  test("how many go at once follows the engine", () => {
    settings({});
    expect(translationBatchSize()).toBe(1);
    settings({ sugoi: "http://127.0.0.1:14366" });
    expect(translationBatchSize()).toBe(64);
    settings({ deepl: "key:fx", preferred: "deepl" });
    expect(translationBatchSize()).toBe(50);
  });
});

describe("a translator having a bad moment", () => {
  test("a server still warming up is waited for, not given up on", async () => {
    let calls = 0;
    const stub = Bun.serve({
      port: 0,
      fetch: () => {
        calls++;
        // Two refusals, as a container loading its model answers, then the real thing
        if (calls <= 2) return new Response("loading", { status: 503 });
        return Response.json(["Let's go, Kate!"]);
      },
    });
    try {
      settings({ sugoi: stub.url.href });
      registerTranslateHandler();
      const result = await inferenceQueue.enqueue<{ text: string }, { translatedText: string }>(
        "translate",
        { text: "行くぞケイト" },
      );
      expect(result.translatedText).toBe("Let's go, Kate!");
      expect(calls).toBe(3);
    } finally {
      stub.stop(true);
    }
  });

  test("a server answering nonsense is not asked twice", async () => {
    let calls = 0;
    const stub = Bun.serve({
      port: 0,
      fetch: () => {
        calls++;
        return Response.json({ unexpected: true });
      },
    });
    try {
      settings({ sugoi: stub.url.href });
      registerTranslateHandler();
      await expect(inferenceQueue.enqueue("translate", { text: "テスト" })).rejects.toThrow(/shape/);
      // The same request would be answered the same way: trying again would only bury the reason
      expect(calls).toBe(1);
    } finally {
      stub.stop(true);
    }
  });
});

describe("an answer that never finished", () => {
  test("a body cut off mid-flight is tried again; one that isn't JSON is not", async () => {
    let calls = 0;
    const stub = Bun.serve({
      port: 0,
      fetch: () => {
        calls++;
        // A complete answer that is not JSON: the server saying something we don't understand
        return new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html" } });
      },
    });
    try {
      settings({ sugoi: stub.url.href });
      registerTranslateHandler();
      await expect(inferenceQueue.enqueue("translate", { text: "テスト" })).rejects.toThrow(/isn't JSON/);
      expect(calls).toBe(1);
    } finally {
      stub.stop(true);
    }
  });
});
