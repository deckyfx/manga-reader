/**
 * The first-run questions, and the file they write.
 *
 * The asking itself needs a terminal, so what is pinned here is everything around it: which command an argument
 * list means, when the questions may be asked at all, and that the file they produce says what was chosen.
 */
import { describe, expect, test } from "bun:test";
import { parseCli } from "@/cli-parser";
import { applySettings, envPath, renderEnv } from "@/commands/setup";

const argv = (...args: string[]) => ["bun", "app", ...args];

describe("what the arguments ask for", () => {
  test("serving is the default", () => {
    expect(parseCli(argv())).toEqual({ type: "serve" });
  });

  test("help and version answer before anything starts", () => {
    expect(parseCli(argv("--help"))).toEqual({ type: "help" });
    expect(parseCli(argv("-h"))).toEqual({ type: "help" });
    expect(parseCli(argv("--version"))).toEqual({ type: "version" });
    expect(parseCli(argv("-V"))).toEqual({ type: "version" });
  });

  test("the questions can be asked again on purpose", () => {
    expect(parseCli(argv("--setup"))).toEqual({ type: "setup" });
  });

  test("an argument it doesn't know is not worth refusing to start over", () => {
    expect(parseCli(argv("--colour=always"))).toEqual({ type: "serve" });
  });
});

describe("the file the answers write", () => {
  test("says what was chosen, and explains itself", () => {
    const env = renderEnv({ PORT: "8080", HOST: "0.0.0.0", OCR_ENGINE: "manga-ocr", PREFERRED_TRANSLATION_ENGINE: "sugoi", SUGOI_URL: "http://127.0.0.1:14366" });
    expect(env).toContain("PORT=8080");
    expect(env).toContain("HOST=0.0.0.0");
    expect(env).toContain("OCR_ENGINE=manga-ocr");
    expect(env).toContain("SUGOI_URL=http://127.0.0.1:14366");
    // A file someone opens months later should explain what the lines are for
    expect(env).toContain("# Where to listen");
    expect(env.startsWith("# web-ocr settings")).toBe(true);
  });

  test("leaves out a secret nobody gave", () => {
    const env = renderEnv({ PREFERRED_TRANSLATION_ENGINE: "local" });
    expect(env).not.toContain("DEEPL_API_KEY");
    expect(env).not.toContain("SUGOI_URL");
    // …and still answers the questions that have defaults
    expect(env).toContain("PORT=3579");
    expect(env).toContain("HOST=127.0.0.1");
    expect(env).toContain("DATA_DIR=./data");
  });

  test("keeps a key when one was given", () => {
    expect(renderEnv({ DEEPL_API_KEY: "abc:fx" })).toContain("DEEPL_API_KEY=abc:fx");
  });

  test("whole-page translation is three switches, moved together", () => {
    const on = renderEnv({ TEXT_SEG_MODEL_ENABLED: "true", INPAINT_MODEL_ENABLED: "true", BUBBLE_MODEL_ENABLED: "true" });
    for (const flag of ["TEXT_SEG_MODEL_ENABLED=true", "INPAINT_MODEL_ENABLED=true", "BUBBLE_MODEL_ENABLED=true"]) {
      expect(on).toContain(flag);
    }
    // Off by default: they are the largest downloads, and not every server wants them
    expect(renderEnv({})).toContain("BUBBLE_MODEL_ENABLED=false");
  });
});

describe("using the answers", () => {
  test("this run takes them, so nobody starts the server twice", () => {
    const before = Bun.env.PORT;
    try {
      applySettings({ PORT: "4321" });
      expect(Bun.env.PORT).toBe("4321");
    } finally {
      if (before === undefined) delete Bun.env.PORT;
      else Bun.env.PORT = before;
    }
  });

  test("the file it reads is the one beside where you started it", () => {
    expect(envPath("/srv/web-ocr")).toBe("/srv/web-ocr/.env");
  });
});

describe("the doctor", () => {
  test("is a command of its own, and says so in the help", async () => {
    expect(parseCli(argv("--doctor"))).toEqual({ type: "doctor" });
    // The help is what somebody reads when nothing works, so the check has to be in it
    const { printUsage } = await import("@/cli-parser");
    const said: string[] = [];
    const log = console.log;
    console.log = (line: string) => said.push(line);
    try {
      printUsage();
    } finally {
      console.log = log;
    }
    expect(said.join("\n")).toContain("--doctor");
  });
});
