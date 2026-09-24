/**
 * The questions a first run asks, and the `.env` it writes from the answers.
 *
 * Only what someone must decide is asked; everything else has a default that works and can be edited in the file
 * afterwards. The questions are skipped entirely when nobody is watching — a service that starts at boot must come
 * up on its own, not wait at a prompt nobody will ever see.
 */
import * as p from "@clack/prompts";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** What the questions produce: settings for the file, and for the process about to use them. */
export type Settings = Record<string, string>;

/** Whether anybody is there to answer. */
export const interactive = (): boolean => Boolean(process.stdin.isTTY && process.stdout.isTTY);

/** The settings file this run would read. */
export const envPath = (dir = process.cwd()): string => join(dir, ".env");

/**
 * The file, as text. Kept apart from the asking so it can be tested, and commented so the file explains itself to
 * whoever opens it next — usually the same person, months later.
 */
export function renderEnv(settings: Settings): string {
  const lines = [
    "# web-ocr settings, written by the setup questions. Anything here can be edited by hand;",
    "# what is absent falls back to a default, and the environment wins over both.",
    "",
    "# Where to listen. 127.0.0.1 answers only this machine; 0.0.0.0 answers the network,",
    "# which over plain http sends passwords and keys across it in clear.",
    `PORT=${settings.PORT ?? "3579"}`,
    `HOST=${settings.HOST ?? "127.0.0.1"}`,
    "",
    "# Everything the server keeps: database, models, pages, logs.",
    `DATA_DIR=${settings.DATA_DIR ?? "./data"}`,
    "",
    "# Which reader turns pictures into Japanese.",
    `OCR_ENGINE=${settings.OCR_ENGINE ?? "baberu"}`,
    "",
    "# Which translator turns it into English: auto | local | deepl | sugoi.",
    `PREFERRED_TRANSLATION_ENGINE=${settings.PREFERRED_TRANSLATION_ENGINE ?? "auto"}`,
  ];
  if (settings.DEEPL_API_KEY) lines.push(`DEEPL_API_KEY=${settings.DEEPL_API_KEY}`);
  if (settings.SUGOI_URL) lines.push(`SUGOI_URL=${settings.SUGOI_URL}`);
  lines.push(
    "",
    "# Whole-page translation needs all three: finding the text, cleaning it off, and reading bubbles.",
    "# They are the largest downloads, and a server that only reads regions does not need them.",
    `TEXT_SEG_MODEL_ENABLED=${settings.TEXT_SEG_MODEL_ENABLED ?? "false"}`,
    `INPAINT_MODEL_ENABLED=${settings.INPAINT_MODEL_ENABLED ?? "false"}`,
    `BUBBLE_MODEL_ENABLED=${settings.BUBBLE_MODEL_ENABLED ?? "false"}`,
    "",
  );
  return lines.join("\n");
}

/** Everything the answers decided, applied to the process that is about to use them. */
export function applySettings(settings: Settings): void {
  for (const [key, value] of Object.entries(settings)) Bun.env[key] = value;
}

/** A cancelled question cancels the lot: nothing is written. */
function keep<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Nothing was written. Run it again when you are ready, or start it as it is to use the defaults.");
    process.exit(0);
  }
  return value as T;
}

/**
 * Asks, writes, and hands back what was chosen. The caller applies it: this run should use the answers rather than
 * ask anyone to start the server twice.
 */
export async function runSetup(dir = process.cwd()): Promise<Settings> {
  p.intro("web-ocr — setting up");
  const file = envPath(dir);
  if (existsSync(file)) {
    const overwrite = keep(await p.confirm({ message: `${file} already exists. Write over it?`, initialValue: false }));
    if (!overwrite) {
      p.cancel("Left as it was.");
      process.exit(0);
    }
  }

  const settings: Settings = {};

  settings.PORT = keep(await p.text({
    message: "Which port should it listen on?",
    initialValue: "3579",
    validate: (value) => {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return "A port is a whole number between 1 and 65535.";
      return undefined;
    },
  }));

  const reachable = keep(await p.confirm({ message: "Reach it from other devices on your network?", initialValue: false }));
  settings.HOST = reachable ? "0.0.0.0" : "127.0.0.1";
  if (reachable) {
    p.log.warn("Over plain http anyone on that network can read the passwords, session cookies and API keys that cross it. Put TLS in front of it before it matters.");
  }

  settings.OCR_ENGINE = keep(await p.select({
    message: "Which OCR reader?",
    initialValue: "baberu",
    options: [
      { value: "baberu", label: "Baberu", hint: "the default; faster, and better on stylised lettering" },
      { value: "manga-ocr", label: "Manga-OCR", hint: "the older, widely used model" },
    ],
  }));

  const translator = keep(await p.select({
    message: "Which translator?",
    initialValue: "local",
    options: [
      { value: "local", label: "The built-in model", hint: "downloaded on first run; nothing leaves this machine" },
      { value: "deepl", label: "DeepL", hint: "needs an API key; best general prose" },
      { value: "sugoi", label: "A Sugoi server of your own", hint: "needs its address; tuned for fiction, research use only" },
    ],
  }));
  if (translator === "deepl") {
    settings.DEEPL_API_KEY = keep(await p.text({
      message: "DeepL API key",
      placeholder: "…:fx for a free key",
      validate: (value) => (value.trim().length === 0 ? "A key is needed to use DeepL." : undefined),
    })).trim();
    settings.PREFERRED_TRANSLATION_ENGINE = "deepl";
  } else if (translator === "sugoi") {
    settings.SUGOI_URL = keep(await p.text({
      message: "Where is the Sugoi server?",
      initialValue: "http://127.0.0.1:14366",
      validate: (value) => {
        try {
          new URL(value);
          return undefined;
        } catch {
          return "That isn't an address — try something like http://127.0.0.1:14366";
        }
      },
    })).trim();
    settings.PREFERRED_TRANSLATION_ENGINE = "sugoi";
  } else {
    settings.PREFERRED_TRANSLATION_ENGINE = "local";
  }

  const wholePages = keep(await p.confirm({
    message: "Translate whole pages, not just selected regions? (about 700 MB more to download)",
    initialValue: true,
  }));
  const wanted = wholePages ? "true" : "false";
  settings.TEXT_SEG_MODEL_ENABLED = wanted;
  settings.INPAINT_MODEL_ENABLED = wanted;
  settings.BUBBLE_MODEL_ENABLED = wanted;

  await Bun.write(file, renderEnv(settings));
  p.note(
    [
      `Written to ${file}`,
      "",
      "The models download on the first start, which takes a few minutes.",
      `Then open http://${settings.HOST === "0.0.0.0" ? "this-machine" : "127.0.0.1"}:${settings.PORT} and make the first account.`,
    ].join("\n"),
    "Ready",
  );
  p.outro("Starting.");
  return settings;
}
