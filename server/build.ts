import { mkdir, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import tailwind from "bun-plugin-tailwind";

/**
 * Fullstack build: the server entry bundles its HTML import → React client + Tailwind inline, and the whole thing
 * compiles to one executable in dist/.
 *
 * The two native modules are bundled rather than left external, because a compiled binary resolves nothing from
 * disk: its imports come from a virtual filesystem with no node_modules in it. Bundling embeds their `.node`
 * addons — but an addon still dlopens its own shared library by name, and those cannot be embedded, so they are
 * copied next to the binary and loaded from there at startup (see src/lib/native-libs.ts).
 *
 *   bun run build                      the machine this runs on
 *   bun run build --target=macos-arm64 somebody else's machine (see the note on cross-building below)
 *   bun run build --archive            …and a tar.gz of the result, named for its target
 */

/** What a target is called here, what Bun calls it, and which of this machine's libraries suit it. */
const TARGETS = {
  ubuntu64: { bun: "bun-linux-x64", platform: "linux", arch: "x64", binary: "app" },
  "linux-arm64": { bun: "bun-linux-arm64", platform: "linux", arch: "arm64", binary: "app" },
  "macos-arm64": { bun: "bun-darwin-arm64", platform: "darwin", arch: "arm64", binary: "app" },
  "macos-x64": { bun: "bun-darwin-x64", platform: "darwin", arch: "x64", binary: "app" },
  windows64: { bun: "bun-windows-x64", platform: "win32", arch: "x64", binary: "app.exe" },
} as const;

type TargetName = keyof typeof TARGETS;

const DIST = "./dist";

/** The shared libraries the embedded addons load at runtime, as this machine has them. */
const NATIVE_LIB_DIRS = [
  "node_modules/onnxruntime-node/bin/napi-v6/linux/x64",
  "node_modules/@img/sharp-libvips-linux-x64/lib",
];

const argument = (name: string): string | undefined =>
  Bun.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const requested = (argument("target") ?? "ubuntu64") as TargetName;
if (!(requested in TARGETS)) {
  console.error(`Unknown target "${requested}". Pick one of: ${Object.keys(TARGETS).join(", ")}`);
  process.exit(1);
}
const target = TARGETS[requested];
const archive = Bun.argv.includes("--archive");

/**
 * Whether this machine's native libraries suit the target. Cross-building the JavaScript is Bun's business and it
 * does it happily; the libraries are ours, and we only have the ones that were installed here. A binary for
 * another platform therefore comes out incomplete, and says so rather than looking finished.
 */
const nativeMatches = target.platform === process.platform && target.arch === process.arch;

/**
 * Where this build lands. The one for this machine takes ./dist, which is what `bun run start` runs and what the
 * README tells people to look for; a build for somebody else's machine goes in a folder of its own, so it cannot
 * quietly replace a binary that runs here with one that does not.
 */
const OUT_DIR = nativeMatches ? DIST : join(DIST, requested);

const result = await Bun.build({
  // boot.ts, not index.ts: it loads the shared libraries before the server's imports can ask for them
  entrypoints: ["./src/boot.ts"],
  compile: { outfile: `${OUT_DIR}/${target.binary}`, target: target.bun },
  plugins: [tailwind],
  target: "bun",
  minify: true,
  sourcemap: "inline",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log.message);
  process.exit(1);
}

const libDir = join(OUT_DIR, "lib");
await rm(libDir, { recursive: true, force: true });
let copied = 0;
if (nativeMatches) {
  await mkdir(libDir, { recursive: true });
  for (const dir of NATIVE_LIB_DIRS) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      console.error(`Missing ${dir} — run bun install for this platform before building`);
      process.exit(1);
    }
    for (const entry of entries) {
      if (!entry.includes(".so")) continue;
      await Bun.write(join(libDir, basename(entry)), Bun.file(join(dir, entry)));
      copied++;
    }
  }
  if (copied === 0) {
    console.error("No shared libraries found to copy — the binary would not start");
    process.exit(1);
  }
}

if (archive) {
  // Staged in a folder of its own so the archive unpacks into one, rather than scattering into the current
  // directory — and so tar can take the files from disk with their permissions intact
  const root = `web-ocr-${requested}`;
  const stage = join(DIST, root);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  await Bun.write(join(stage, target.binary), Bun.file(join(OUT_DIR, target.binary)));
  await Bun.$`chmod +x ${join(stage, target.binary)}`.quiet();
  if (nativeMatches) {
    await mkdir(join(stage, "lib"), { recursive: true });
    for (const entry of await readdir(libDir)) {
      await Bun.write(join(stage, "lib", entry), Bun.file(join(libDir, entry)));
    }
  }

  // tar rather than Bun.Archive, which writes the files but not their permissions: the executable would come out
  // of the archive unable to run, which is a poor first impression and an obscure one to diagnose
  const out = `${DIST}/${root}.tar.gz`;
  const tarred = await Bun.$`tar -czf ${out} -C ${DIST} ${root}`.nothrow().quiet();
  await rm(stage, { recursive: true, force: true });
  if (tarred.exitCode !== 0) {
    console.error(`Could not write ${out}: ${tarred.stderr.toString().trim() || "tar failed"}`);
    process.exit(1);
  }
  console.log(`Archived → ${out} (${(Bun.file(out).size / 1_048_576).toFixed(0)} MB)`);
}

console.log(`Build complete → ${join(OUT_DIR, target.binary)} for ${requested}`);
if (nativeMatches) console.log(`  ${copied} shared libraries in ${libDir}, loaded by the binary itself`);
else {
  console.log(`  no shared libraries: this machine has ${process.platform}/${process.arch} builds and ${requested} needs ${target.platform}/${target.arch}.`);
  console.log(`  The binary will start and then fail to load onnxruntime and sharp. Build it on a ${target.platform} machine,`);
  console.log(`  or install those two packages for ${target.platform}/${target.arch} beside it and copy their .so files into lib/.`);
}
