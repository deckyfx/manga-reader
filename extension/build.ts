import { $ } from "bun";
import path from "node:path";

const DEV = process.argv.includes("--dev");
const MINOR = process.argv.includes("--minor");
/** Don't touch the version at all — for a check that must leave the working tree as it found it. */
const NO_BUMP = process.argv.includes("--no-bump");
/** Use exactly this version, rather than working one out — for a release, where the tag is the version. */
const GIVEN = process.argv.find((a) => a.startsWith("--version="))?.split("=")[1];

// ── Version ────────────────────────────────────────────────────────────────────
// Ordinarily this bumps the patch (or the minor with --minor) and writes it to package.json and
// static/manifest.json so the two stay in sync. A build that is checking something, or building a version somebody
// else decided, says so: --no-bump leaves both files alone, and --version=X.Y.Z writes that and nothing else.

const pkgFile      = Bun.file("./package.json");
const manifestFile = Bun.file("./static/manifest.json");

const pkg      = await pkgFile.json()      as { version: string; [k: string]: unknown };
const manifest = await manifestFile.json() as { version: string; [k: string]: unknown };

const [major, minor, patch] = (pkg.version ?? "1.0.0").split(".").map(Number);
const bumped = MINOR
  ? `${major}.${(minor ?? 0) + 1}.0`
  : `${major}.${minor}.${(patch ?? 0) + 1}`;
const newVersion = GIVEN ?? (NO_BUMP ? (pkg.version ?? "1.0.0") : bumped);

/**
 * Chrome is particular about a manifest version, and finds out at install time rather than at build time: one to
 * four numbers, each 0–65535, no leading zeros, and not every one of them zero. A tag that breaks those rules
 * should stop the build here, not the upload later.
 */
function versionComplaint(version: string): string | null {
  const parts = version.split(".");
  if (parts.length < 1 || parts.length > 4) return "it takes one to four numbers separated by dots";
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return `"${part}" is not a number`;
    if (part.length > 1 && part.startsWith("0")) return `"${part}" has a leading zero, which Chrome rejects`;
    if (Number(part) > 65535) return `${part} is above 65535, which Chrome rejects`;
  }
  if (parts.every((part) => Number(part) === 0)) return "every number is zero, which Chrome rejects";
  return null;
}

if (GIVEN !== undefined) {
  const complaint = versionComplaint(GIVEN);
  if (complaint !== null) {
    console.error(`--version=${GIVEN} won't do: ${complaint}.`);
    process.exit(1);
  }
}

if (!NO_BUMP) {
  pkg.version      = newVersion;
  manifest.version = newVersion;
  await Bun.write(pkgFile,      JSON.stringify(pkg,      null, 2) + "\n");
  await Bun.write(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
}

console.log(`📦 Building Manga Reader extension v${newVersion}${DEV ? " (dev)" : ""}\n`);

console.log("  Cleaning dist...");
await $`rm -rf ./dist && mkdir -p ./dist`;

const entries = [
  { name: "background", file: "./src/background.ts" },
  { name: "content",    file: "./src/content.ts" },
  { name: "options",    file: "./src/options.ts" },
  { name: "engine",     file: "./src/engine.ts" },
  { name: "popup",      file: "./src/popup.ts" },
];

// Resolve the extension's runtime URL prefix for engine.ts WASM paths.
// We inject it as a build-time define so no chrome.runtime call is needed inside engine.ts.
// In practice the worker reads its own URL, but we use a placeholder that engine.ts uses
// via __EXTENSION_URL__ which at runtime is replaced with chrome.runtime.getURL("").
// Actually we pass it as a define so engine.ts can use it without a runtime chrome.runtime call
// (engine.html runs as a web-accessible resource with full access to chrome.runtime anyway).

let ok = true;

for (const { name, file } of entries) {
  process.stdout.write(`  Building ${name}.ts...`);

  const result = await Bun.build({
    entrypoints: [file],
    outdir: "./dist",
    target: "browser",
    format: "iife",
    minify: !DEV,
    // engine.ts needs to call chrome.runtime.getURL at runtime, so we pass a placeholder
    // that gets replaced at runtime. The define just ensures the symbol resolves.
    define: {},
  });

  if (!result.success) {
    console.log(" ❌");
    for (const log of result.logs) console.error(`    ${log.message}`);
    ok = false;
  } else {
    console.log(" ✅");
  }
}

if (!ok) {
  console.error("\n❌ Build failed.");
  process.exit(1);
}

console.log("  Copying static files...");
await $`cp -r ./static/* ./dist/`;

// ── Vendor Tesseract.js files ──────────────────────────────────────────────────
// Copy worker + WASM files from node_modules into dist/tesseract/
// so they can be referenced as chrome.runtime.getURL("tesseract/...")

console.log("  Copying Tesseract vendor files...");
await $`mkdir -p ./dist/tesseract`;

const nodeModules = path.join(import.meta.dir, "node_modules");

// tesseract.js worker
const workerSrc = path.join(nodeModules, "tesseract.js", "dist", "worker.min.js");
await $`cp ${workerSrc} ./dist/tesseract/worker.min.js`;

// tesseract.js browser bundle (loaded as a <script> tag — NOT bundled by Bun)
const tJsSrc = path.join(nodeModules, "tesseract.js", "dist", "tesseract.min.js");
await $`cp ${tJsSrc} ./dist/tesseract/tesseract.min.js`;
process.stdout.write(`    tesseract.min.js ✅\n`);

// tesseract.js-core WASM files (simd-lstm variant: best cross-browser + accuracy)
const coreDir = path.join(nodeModules, "tesseract.js-core");
const wasmFiles = [
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm",
];

for (const f of wasmFiles) {
  const src = path.join(coreDir, f);
  try {
    await $`cp ${src} ./dist/tesseract/${f}`;
    process.stdout.write(`    ${f} ✅\n`);
  } catch {
    // Some versions bundle only the .js wrapper (contains embedded WASM); skip .wasm if missing
    process.stdout.write(`    ${f} — not found, skipping\n`);
  }
}

console.log("  ✅\n");
console.log("🎉 Extension ready in ./dist/");
console.log("   Load it in Chrome: chrome://extensions → Load unpacked → select ./dist/\n");

if (!DEV) {
  // ── Archive (zip — required by Chrome Web Store and manual sideloading) ─────
  process.stdout.write("  Archiving dist → manga-reader-chrome.zip...");

  await Bun.$`rm -f manga-reader-chrome.zip && cd dist && zip -rq ../manga-reader-chrome.zip .`;

  const size = Bun.file("manga-reader-chrome.zip").size;
  console.log(` ✅  (${(size / 1024).toFixed(1)} KB)`);
  console.log("   manga-reader-chrome.zip ready for Chrome Web Store or manual install.");
}
