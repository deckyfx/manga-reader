/**
 * What this machine can and cannot run, said plainly.
 *
 * The executable is not self-sufficient: it carries its code and its fonts, but the shared libraries its native
 * parts open live beside it, the models are downloaded, and everything it keeps lives in a directory it must be
 * able to write. Each of those fails in its own way and usually at the worst moment — half a page into a run, or
 * ten minutes into a download. This checks them all before any of that, and says which one is wrong.
 *
 * It exits 0 when the server could run, and 1 when something would stop it — so a machine, not just a person, can
 * read the answer.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { arch, cpus, freemem, platform, release, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { env } from "@/env";

type State = "ok" | "warn" | "bad";

interface Check {
  area: string;
  state: State;
  detail: string;
}

const gb = (bytes: number): string => `${(bytes / 1_073_741_824).toFixed(1)} GB`;
const mb = (bytes: number): string => `${Math.round(bytes / 1_048_576)} MB`;

/** Whether this is the compiled executable rather than a run from source. */
const compiled = (): boolean => Bun.main.startsWith("/$bunfs/");

/** Bytes in a directory, one level deep — enough to say whether a model looks downloaded. */
function sizeOf(dir: string): number {
  try {
    return readdirSync(dir).reduce((sum, entry) => {
      try {
        const stat = statSync(join(dir, entry));
        return sum + (stat.isFile() ? stat.size : 0);
      } catch {
        return sum;
      }
    }, 0);
  } catch {
    return 0;
  }
}

/** The machine, and what this build is. */
function environment(): Check[] {
  const checks: Check[] = [
    { area: "host", state: "ok", detail: `${platform()} ${arch()}, kernel ${release()}, ${cpus().length} cores, ${gb(totalmem())} memory (${gb(freemem())} free)` },
    { area: "runtime", state: "ok", detail: `bun ${Bun.version}${compiled() ? ", compiled executable" : ", from source"}` },
  ];
  // A page's heaviest stage has been measured needing about a gigabyte above the models
  if (totalmem() < 4 * 1_073_741_824) {
    checks.push({ area: "memory", state: "warn", detail: `${gb(totalmem())} is tight — the models alone hold about 2 GB once loaded` });
  }
  return checks;
}

/** The shared libraries the embedded addons open, and whether the addons in fact load. */
async function natives(): Promise<Check[]> {
  const checks: Check[] = [];
  if (compiled()) {
    const dir = join(dirname(process.execPath), "lib");
    const found = existsSync(dir) ? readdirSync(dir).filter((f) => f.includes(".so")) : [];
    checks.push(
      found.length > 0
        ? { area: "libraries", state: "ok", detail: `${found.join(", ")} in ${dir}` }
        : { area: "libraries", state: "bad", detail: `nothing in ${dir} — the executable needs its lib/ directory beside it` },
    );
  }
  try {
    const ort = await import("onnxruntime-node");
    checks.push({ area: "onnxruntime", state: typeof ort.InferenceSession === "function" ? "ok" : "bad", detail: "loads" });
  } catch (err) {
    checks.push({ area: "onnxruntime", state: "bad", detail: err instanceof Error ? err.message : String(err) });
  }
  try {
    const sharp = (await import("@/lib/sharp")).default;
    const { vips } = sharp.versions as { vips?: string };
    await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer();
    checks.push({ area: "sharp", state: "ok", detail: `works${vips ? `, libvips ${vips}` : ""}` });
  } catch (err) {
    checks.push({ area: "sharp", state: "bad", detail: err instanceof Error ? err.message : String(err) });
  }
  return checks;
}

/** The lettering fonts, which travel inside the executable rather than beside it. */
async function fonts(): Promise<Check[]> {
  try {
    const { getTypesetter } = await import("@/services/typeset-service");
    await getTypesetter();
    return [{ area: "fonts", state: "ok", detail: "the three Anime Ace faces load and parse" }];
  } catch (err) {
    return [{ area: "fonts", state: "bad", detail: err instanceof Error ? err.message : String(err) }];
  }
}

/** Every model this server is set up to use: is it switched on, and is it actually there? */
function models(): Check[] {
  const wanted = [
    { area: `ocr (${env.OCR_ENGINE})`, on: env.OCR_MODEL_ENABLED, dir: env.OCR_MODELS_DIR, files: env.OCR_MODEL_FILES },
    { area: "translate", on: env.TRANSLATE_MODEL_ENABLED, dir: env.TRANSLATE_MODELS_DIR, files: env.TRANSLATE_MODEL_FILES },
    { area: "inpaint", on: env.INPAINT_MODEL_ENABLED, dir: env.INPAINT_MODELS_DIR, files: env.INPAINT_MODEL_FILES },
    { area: "bubble", on: env.BUBBLE_MODEL_ENABLED, dir: env.BUBBLE_MODELS_DIR, files: env.BUBBLE_MODEL_FILES },
    { area: "text_seg", on: env.TEXT_SEG_MODEL_ENABLED, dir: env.TEXT_SEG_MODELS_DIR, files: env.TEXT_SEG_MODEL_FILES },
    { area: "dictionary", on: env.DICT_MODEL_ENABLED, dir: env.DICT_DIR, files: [] },
  ];
  return wanted.map(({ area, on, dir, files }) => {
    if (!on) return { area, state: "ok" as State, detail: "switched off" };
    const missing = files.filter((file) => !existsSync(join(dir, file.split("/").pop() ?? file)));
    const size = sizeOf(dir);
    if (!existsSync(dir) || size === 0) return { area, state: "warn" as State, detail: `nothing in ${dir} yet — it downloads on the next start` };
    if (missing.length > 0) return { area, state: "warn" as State, detail: `${missing.join(", ")} missing from ${dir} — they download on the next start` };
    return { area, state: "ok" as State, detail: `${mb(size)} in ${dir}` };
  });
}

/** Where everything is kept, and whether it can be written to. */
async function storage(): Promise<Check[]> {
  const checks: Check[] = [];
  const dir = env.DATA_DIR;
  // Written to only if it is already there: a question about the machine should not leave anything behind
  const probeIn = existsSync(dir) ? dir : dirname(dir) || ".";
  try {
    const probe = join(probeIn, `.doctor-${Math.random().toString(36).slice(2)}`);
    await Bun.write(probe, "");
    await Bun.file(probe).delete();
    checks.push(
      existsSync(dir)
        ? { area: "data dir", state: "ok", detail: `${dir}, writable` }
        : { area: "data dir", state: "ok", detail: `${dir} — not there yet; it is made on the first start, and ${probeIn} can be written` },
    );
  } catch (err) {
    checks.push({ area: "data dir", state: "bad", detail: `${probeIn} cannot be written: ${err instanceof Error ? err.message : String(err)}` });
  }
  const db = env.DATABASE_URL.replace(/^file:/, "");
  checks.push(
    existsSync(db)
      ? { area: "database", state: "ok", detail: `${db}, ${mb(sizeOf(dirname(db)))} in its folder` }
      : { area: "database", state: "warn", detail: `${db} not there yet — it is created, and migrated, on the first start` },
  );
  const secret = env.SECRET_KEY_FILE;
  checks.push({
    area: "secret key",
    state: "ok",
    // Never its contents: it encrypts the authenticator secrets, and this output is the sort of thing people paste
    detail: existsSync(secret) ? `${secret} (keep it with the database — without it, enrolled authenticator apps stop working)` : `${secret} — made on first use`,
  });
  return checks;
}

const MARK: Record<State, string> = { ok: "ok  ", warn: "warn", bad: "BAD " };

/** Runs every check, prints them, and exits 1 if anything would stop the server. */
export async function runDoctor(): Promise<never> {
  const pkg = await import("../../package.json");
  const version = (pkg as { version?: string }).version ?? "(no version)";
  console.log(`web-ocr ${version} — checking this machine\n`);

  const groups: [string, Check[]][] = [
    ["Machine", environment()],
    ["Native parts", await natives()],
    ["Fonts", await fonts()],
    ["Models", models()],
    ["Storage", await storage()],
  ];

  let bad = 0;
  let warned = 0;
  for (const [title, checks] of groups) {
    console.log(`${title}`);
    for (const check of checks) {
      if (check.state === "bad") bad++;
      if (check.state === "warn") warned++;
      console.log(`  [${MARK[check.state]}] ${check.area.padEnd(14)} ${check.detail}`);
    }
    console.log("");
  }

  if (bad > 0) console.log(`${bad} thing${bad === 1 ? "" : "s"} would stop the server${warned > 0 ? `, and ${warned} worth knowing about` : ""}.`);
  else if (warned > 0) console.log(`Nothing would stop it; ${warned} thing${warned === 1 ? "" : "s"} worth knowing about.`);
  else console.log("Everything this server needs is here.");

  process.exit(bad > 0 ? 1 : 0);
}
