/**
 * Which hosts count as "inside the client's own network", and so which addresses a series cover is refused from.
 *
 * The extension imports this same module, so these cases are the rule itself rather than a copy of it. The cover
 * address comes from `og:image` on whatever page the user is looking at: a page can already make a browser request
 * a LAN address, but it cannot read the answer, and the worker could — then upload it here.
 *
 * Addresses go through `new URL()` wherever the real caller would, because that is where they change shape:
 * `::ffff:192.168.1.1` arrives at the check as `::ffff:c0a8:101`. Testing the raw string is how that was missed
 * the first time.
 */
import { describe, expect, test } from "bun:test";
import { isPrivateHost } from "@/shared/private-host";

/** The host as the worker sees it: whatever `URL` made of what the page supplied. */
const hostOf = (host: string): string => new URL(`http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}/x`).hostname;

describe("addresses on the client's own network", () => {
  test("the machine itself", () => {
    for (const host of ["localhost", "app.localhost", "printer.local", "127.0.0.1", "127.1.2.3", "0.0.0.0", "::1", "[::1]", "::"]) {
      expect(isPrivateHost(host)).toBe(true);
    }
  });

  test("private and link-local IPv4", () => {
    // 169.254.169.254 is the cloud metadata address, which is the classic thing this kind of fetch is aimed at
    for (const host of ["10.0.0.5", "172.16.0.1", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "224.0.0.1"]) {
      expect(isPrivateHost(host)).toBe(true);
    }
  });

  test("IPv6 forms that look public at a glance", () => {
    for (const host of [
      "fe80::1",            // link-local
      "[fe80::1]",
      "feb0::1",            // still fe80::/10
      "fd00::1",            // unique local
      "fc00::1",
      "::ffff:192.168.1.1", // an IPv4 private address written inside an IPv6 one
      "[::ffff:127.0.0.1]",
      "::ffff:0:192.168.1.1",
      "::192.168.1.1",
    ]) {
      expect(isPrivateHost(host)).toBe(true);
    }
  });

  test("and the same addresses after a URL has normalised them", () => {
    // `URL` rewrites the dotted tail as hex pairs: ::ffff:192.168.1.1 becomes ::ffff:c0a8:101. The check runs on
    // `URL.hostname`, so this is the shape that actually has to be caught
    for (const host of ["::ffff:192.168.1.1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "fe80::1"]) {
      expect(isPrivateHost(hostOf(host))).toBe(true);
    }
    // The hex spelling written out by hand reaches the same place
    expect(isPrivateHost("::ffff:c0a8:101")).toBe(true);
    expect(isPrivateHost("::ffff:7f00:1")).toBe(true);
  });
});

describe("addresses out on the internet", () => {
  test("ordinary hosts, including ones that merely look private", () => {
    for (const host of [
      "cdn.example.com",
      "cdn10.example.com",
      "172.32.0.1",      // just outside 172.16/12
      "11.0.0.1",        // just outside 10/8
      "192.169.0.1",     // just outside 192.168/16
      "169.255.0.1",     // just outside 169.254/16
      "100.63.0.1",      // just outside the CGNAT range
      "2606:4700::1111", // a public IPv6 address
      "::ffff:8.8.8.8",  // a public IPv4 written inside an IPv6 one
    ]) {
      expect(isPrivateHost(host)).toBe(false);
    }
    // Normalised too: 8.8.8.8 becomes ::ffff:808:808, which must stay allowed
    expect(isPrivateHost(hostOf("::ffff:8.8.8.8"))).toBe(false);
    expect(isPrivateHost(hostOf("2606:4700::1111"))).toBe(false);
  });

  test("a name is treated as public, because deciding otherwise needs a resolver", () => {
    // This is the known limit: the extension has no resolver, and the server pins DNS for its own fetches instead
    expect(isPrivateHost("internal.corp.example")).toBe(false);
  });

  test("nothing at all is refused rather than allowed", () => {
    expect(isPrivateHost("")).toBe(true);
    expect(isPrivateHost("   ")).toBe(true);
  });
});
