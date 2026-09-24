/**
 * sharp, imported the one way a compiled binary can follow.
 *
 * sharp ships two builds. The ESM one loads its native binding through `createRequire(import.meta.url)` — a
 * require the bundler cannot see, so it is left to run at startup, and inside a compiled binary it resolves from
 * the virtual filesystem, where no node_modules exists. The CJS build asks for the same binding with a plain
 * static `require`, which the bundler follows and embeds.
 *
 * Reaching that build takes a real `.cjs` file beside this one: a `require()` written inside a module the bundler
 * treats as ESM is resolved as an import again, and lands back on the build that cannot be followed.
 */
import type Sharp from "sharp";
import sharpCjs from "./sharp.cjs";

const sharp = sharpCjs as unknown as typeof Sharp;
export default sharp;
