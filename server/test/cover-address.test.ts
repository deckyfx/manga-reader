/**
 * Which addresses a series cover may be fetched from.
 *
 * The rule lives in the extension's worker, but the reasoning is the server's kind: an address that came off
 * somebody else's page must not be used to read something inside the user's own network and upload it here. The
 * pattern is tested rather than the fetch, because the fetch belongs to the browser.
 */
import { describe, expect, test } from "bun:test";

/**
 * A copy of `PRIVATE_HOST` from `extension/src/import-queue.ts`. The extension can't be imported here — it's built
 * for a browser, against chrome APIs — so this test guards the pattern itself, and the comment in both files says
 * they move together.
 */
const PRIVATE_HOST = /^(?:localhost|127\.|0\.0\.0\.0|\[?::1\]?|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[?f[cd][0-9a-f]{2}:)/i;

const blocked = (host: string) => PRIVATE_HOST.test(host);

describe("a cover address", () => {
  test("is refused when it points at the machine itself", () => {
    for (const host of ["localhost", "127.0.0.1", "127.1.2.3", "0.0.0.0", "::1", "[::1]"]) {
      expect(blocked(host)).toBe(true);
    }
  });

  test("is refused when it points into a private network", () => {
    // The router's admin page is the one everybody has: 192.168.1.1
    for (const host of ["192.168.1.1", "10.0.0.5", "172.16.0.1", "172.31.255.1", "169.254.169.254", "fd00::1", "[fd00::1]"]) {
      expect(blocked(host)).toBe(true);
    }
  });

  test("allows ordinary public hosts, including ones that merely look private", () => {
    // 172.32 is outside the private range, and a name containing "10." is not an address
    for (const host of ["cdn.example.com", "172.32.0.1", "11.0.0.1", "cdn10.example.com", "192.169.0.1"]) {
      expect(blocked(host)).toBe(false);
    }
  });
});
