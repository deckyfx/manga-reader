/**
 * The entry the executable is built from.
 *
 * It exists to do one thing before the server's own imports are evaluated: put the shared libraries the embedded
 * native addons need among the objects already loaded. A static import of the server here would be hoisted above
 * that, and the addons would look for their libraries before they were there — so the server is brought in
 * afterwards, by hand.
 */
// First of all, and before anything that might reach the passkey library: @simplewebauthn pulls in @peculiar/x509,
// which uses tsyringe, which refuses to load unless this polyfill is already there. From source it happens to be
// loaded in time; in a bundle the order is the bundler's, and tsyringe gets there first.
import "reflect-metadata";
import { preloadNativeLibraries } from "@/lib/native-libs";

preloadNativeLibraries();

await import("@/index");
