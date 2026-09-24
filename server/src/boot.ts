/**
 * The entry: everything starts here, whether from source or from the built executable.
 *
 * Two things have to happen before the server itself is imported, which is why it is brought in by hand at the
 * end rather than with a static import that would be hoisted above them.
 *
 * The shared libraries the embedded native addons open must already be loaded, or the addons will not find them.
 *
 * And a command that isn't "serve" must be answered before the server's imports run, because those imports *do*
 * things: the database module opens its file on import, creating it, and the logger makes its directory. A
 * question like --doctor is meant to describe the machine, not change it.
 */
// First of all, and before anything that might reach the passkey library: @simplewebauthn pulls in @peculiar/x509,
// which uses tsyringe, which refuses to load unless this polyfill is already there. From source it happens to be
// loaded in time; in a bundle the order is the bundler's, and tsyringe gets there first.
import "reflect-metadata";
import { existsSync } from "node:fs";
import { preloadNativeLibraries } from "@/lib/native-libs";

preloadNativeLibraries();

const { parseCli, printUsage } = await import("@/cli-parser");
const command = parseCli();

if (command.type === "help") {
  printUsage();
  process.exit(0);
}

if (command.type === "version") {
  const pkg = await import("../package.json");
  console.log(`web-ocr ${(pkg as { version?: string }).version ?? "(no version)"}`);
  process.exit(0);
}

if (command.type === "doctor") {
  const { runDoctor } = await import("@/commands/doctor");
  await runDoctor();
}

if (command.type === "setup") {
  const { runSetup } = await import("@/commands/setup");
  await runSetup(process.cwd(), false);
  process.exit(0);
}

// A first run with nobody's settings, and somebody watching to answer: offer the questions, and use the answers
// here rather than asking anyone to start the server a second time
const { applySettings, envPath, interactive, runSetup } = await import("@/commands/setup");
if (!existsSync(envPath()) && interactive()) applySettings(await runSetup());

await import("@/index");
