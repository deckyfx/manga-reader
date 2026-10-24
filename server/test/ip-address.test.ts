/**
 * The address rule behind every image the server downloads on somebody's behalf (src/lib/ip-address.ts): which
 * addresses count as public, and so may be connected to.
 *
 * Not the same rule as cover-address.test.ts, which pins `isPrivateHost` — the extension's check on a host *name*,
 * made without a resolver. This one sees the addresses DNS actually answered, at connect time, and fails closed:
 * anything it cannot parse is not public.
 *
 * The range edges are tested on both sides. A test that only asks about 192.168.1.1 passes for a rule that blocks
 * all of 192.0.0.0/8 — and that rule would refuse half the internet's image hosts.
 */
import { describe, expect, test } from "bun:test";
import { isNonPublicAddress, parseIPv4, parseIPv6 } from "@/lib/ip-address";

const refused = (address: string): boolean => isNonPublicAddress(address);

describe("reading an IPv4 address", () => {
  test("four decimal parts, each 0–255", () => {
    expect(parseIPv4("0.0.0.0")).toBe(0);
    expect(parseIPv4("127.0.0.1")).toBe(0x7f000001);
    expect(parseIPv4("255.255.255.255")).toBe(0xffffffff);
  });

  test("nothing a URL parser would read differently: no octal, hex, short or overlong forms", () => {
    // Leading zeros are octal to some parsers (010 = 8), so they are not read at all rather than read one way
    for (const text of ["010.0.0.1", "0x7f.0.0.1", "127.1", "2130706433", "1.2.3.4.5", "256.0.0.1", "1.2.3.-1", "1.2.3.", "", " 1.2.3.4", "1.2.3.4 "]) {
      expect(parseIPv4(text)).toBeNull();
    }
  });
});

describe("reading an IPv6 address", () => {
  const hex = (bytes: Uint8Array | null): string | null => bytes === null ? null : Buffer.from(bytes).toString("hex");

  test("full, compressed, with an IPv4 tail, and with a zone", () => {
    expect(hex(parseIPv6("2001:db8:0:0:0:0:0:1"))).toBe("20010db8000000000000000000000001");
    expect(hex(parseIPv6("2001:db8::1"))).toBe("20010db8000000000000000000000001");
    expect(hex(parseIPv6("::"))).toBe("0".repeat(32));
    expect(hex(parseIPv6("1::"))).toBe(`0001${"0".repeat(28)}`);
    expect(hex(parseIPv6("::ffff:1.2.3.4"))).toBe("00000000000000000000ffff01020304");
    expect(hex(parseIPv6("fe80::1%eth0"))).toBe("fe800000000000000000000000000001");
  });

  test("refuses what is not an address", () => {
    for (const text of [
      "", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "1::2::3", "12345::", "g::1",
      // `::` must stand for at least one group, so eight around it are one too many
      "1:2:3:4:5:6:7::8",
      // A dotted tail ends the address; it can't come first or stand before a `::`
      "1.2.3.4::", "::1.2.3",
    ]) {
      expect(parseIPv6(text)).toBeNull();
    }
  });
});

describe("IPv4 addresses the server will not connect to", () => {
  test("the machine itself, the local networks, and the cloud metadata address", () => {
    for (const address of ["127.0.0.1", "127.255.255.254", "0.0.0.0", "10.1.2.3", "192.168.0.10", "169.254.169.254"]) {
      expect(refused(address)).toBe(true);
    }
  });

  test("each range ends where it should, on both sides", () => {
    const edges: [string, boolean][] = [
      ["172.15.255.255", false], ["172.16.0.0", true], ["172.31.255.255", true], ["172.32.0.0", false],
      // Carrier-grade NAT
      ["100.63.255.255", false], ["100.64.0.0", true], ["100.127.255.255", true], ["100.128.0.0", false],
      // Benchmarking
      ["198.17.255.255", false], ["198.18.0.0", true], ["198.19.255.255", true], ["198.20.0.0", false],
      // Documentation, and the protocol block just before it
      ["192.0.0.1", true], ["192.0.1.1", false], ["192.0.2.1", true], ["192.0.3.1", false],
      // Multicast and reserved run to the end of the space
      ["223.255.255.255", false], ["224.0.0.0", true], ["255.255.255.255", true],
    ];
    for (const [address, expected] of edges) expect([address, refused(address)]).toEqual([address, expected]);
  });

  test("ordinary hosts are allowed", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "104.16.0.1", "11.0.0.1"]) expect(refused(address)).toBe(false);
  });
});

describe("IPv6 addresses the server will not connect to", () => {
  test("loopback, unspecified, local and multicast", () => {
    for (const address of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "fec0::1", "ff02::1", "2001:db8::1", "100::1"]) {
      expect(refused(address)).toBe(true);
    }
  });

  test("an IPv4 address dressed as IPv6 is judged as the IPv4 address it carries", () => {
    // Mapped (both spellings: a URL turns ::ffff:127.0.0.1 into ::ffff:7f00:1), NAT64 and 6to4
    for (const [address, expected] of [
      ["::ffff:127.0.0.1", true], ["::ffff:7f00:1", true], ["::ffff:8.8.8.8", false],
      ["64:ff9b::7f00:1", true], ["64:ff9b::808:808", false],
      ["2002:7f00:1::", true], ["2002:808:808::1", false],
    ] as const) {
      expect([address, refused(address)]).toEqual([address, expected]);
    }
  });

  test("the deprecated IPv4-compatible form is refused whatever it carries", () => {
    expect(refused("::127.0.0.1")).toBe(true);
    expect(refused("::8.8.8.8")).toBe(true);
  });

  test("global unicast is allowed, and only global unicast", () => {
    for (const address of ["2606:4700:4700::1111", "2001:4860:4860::8888", "3fff::1", "[2606:4700::1111]"]) {
      expect(refused(address)).toBe(false);
    }
    // Outside 2000::/3 nothing is assigned for use on the internet
    for (const address of ["4000::1", "1000::1", "e000::1"]) expect(refused(address)).toBe(true);
  });
});

describe("what isn't an address at all", () => {
  test("fails closed: a name, nothing, or garbage is never public", () => {
    for (const text of ["example.com", "", "   ", "1.2.3", "1::2::3", "localhost"]) expect(refused(text)).toBe(true);
  });

  test("surrounding space and brackets are not what decides it", () => {
    expect(refused(" 8.8.8.8 ")).toBe(false);
    expect(refused("[::1]")).toBe(true);
  });
});
