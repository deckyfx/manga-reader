/**
 * The entry the executable is built from.
 *
 * It exists to do one thing before the server's own imports are evaluated: put the shared libraries the embedded
 * native addons need among the objects already loaded. A static import of the server here would be hoisted above
 * that, and the addons would look for their libraries before they were there — so the server is brought in
 * afterwards, by hand.
 */
import { preloadNativeLibraries } from "@/lib/native-libs";

preloadNativeLibraries();

await import("@/index");
