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
 * copied next to the binary and the loader is pointed at them (see dist/start.sh).
 */
const OUT_DIR = "./dist";
const OUT = `${OUT_DIR}/app`;

/** The shared libraries the embedded addons load at runtime, wherever this machine keeps them. */
const NATIVE_LIB_DIRS = [
  "node_modules/onnxruntime-node/bin/napi-v6/linux/x64",
  "node_modules/@img/sharp-libvips-linux-x64/lib",
];

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  compile: { outfile: OUT },
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

// The shared objects, beside the binary: named by their soname, which is how the addons ask for them
const libDir = join(OUT_DIR, "lib");
await rm(libDir, { recursive: true, force: true });
await mkdir(libDir, { recursive: true });
let copied = 0;
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

// A binary that finds its libraries: dlopen searches neither the executable's directory nor the working one
await Bun.write(
  `${OUT_DIR}/start.sh`,
  `#!/usr/bin/env sh\n` +
    `# The addons inside the binary load these by name, and dlopen looks in neither the binary's directory nor\n` +
    `# the working one. Run the server through this, or set LD_LIBRARY_PATH yourself.\n` +
    `here=$(cd "$(dirname "$0")" && pwd)\n` +
    `LD_LIBRARY_PATH="$here/lib\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" exec "$here/app" "$@"\n`,
);
await Bun.$`chmod +x ${OUT_DIR}/start.sh`.quiet();

console.log(`Build complete → ${OUT} (+ ${copied} shared libraries in ${libDir}, run it with ${OUT_DIR}/start.sh)`);
