/**
 * The shared libraries the compiled binary carries beside it, loaded before anything asks for them.
 *
 * Bundling embeds the native `.node` addons, but each addon then dlopens its own shared library *by name* —
 * `libonnxruntime.so.1`, `libvips-cpp.so.x` — and the dynamic loader searches neither the executable's directory
 * nor the working one. Loading them here by absolute path puts them among the objects already resident, which is
 * where the loader looks first, so the addons find them without LD_LIBRARY_PATH or a wrapper script.
 *
 * Running from source this does nothing: there the addons resolve their libraries through node_modules as usual.
 */
import { dlopen, FFIType } from "bun:ffi";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { childLogger } from "@/lib/logger";

const log = childLogger("native");

/**
 * A library to load, and one symbol from it. The symbol is not for calling — `dlopen` here simply needs something
 * to bind, and asking for a name that exists is how it knows the library is the one it expects.
 */
const LIBRARIES: { match: (file: string) => boolean; symbols: Parameters<typeof dlopen>[1] }[] = [
  { match: (f) => f === "libonnxruntime.so.1", symbols: { OrtGetApiBase: { args: [], returns: FFIType.ptr } } },
  // The version travels in libvips' file name and moves with the dependency, so it is matched by prefix
  { match: (f) => f.startsWith("libvips-cpp.so"), symbols: { vips_version: { args: [FFIType.i32], returns: FFIType.i32 } } },
];

/** Whether this is the compiled executable rather than a run from source. */
const compiled = (): boolean => Bun.main.startsWith("/$bunfs/");

/**
 * Loads the libraries in `lib/` beside the executable. Safe to call always: it does nothing when running from
 * source, and a library it cannot load is left to the ordinary loader rather than stopping the server here.
 */
export function preloadNativeLibraries(): void {
  if (!compiled()) return;
  const dir = join(dirname(process.execPath), "lib");
  if (!existsSync(dir)) {
    log.warn({ dir }, "No lib/ beside the executable — the native modules will have to find their own libraries");
    return;
  }
  const files = readdirSync(dir);
  for (const { match, symbols } of LIBRARIES) {
    const file = files.find(match);
    if (!file) continue;
    try {
      dlopen(join(dir, file), symbols);
    } catch (err) {
      // Perhaps the system has its own copy, which the loader will find in the usual way
      log.warn({ err, file }, "Could not preload a native library");
    }
  }
}
