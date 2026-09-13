/** Address checks for outbound requests made on a user's behalf (e.g. fetching a page image by URL). */

/** IPv4 ranges that are not public unicast: this-network, private, CGNAT, loopback, link-local, protocol assignments, documentation, benchmarking, multicast, reserved. */
const NON_PUBLIC_V4: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

/** Strict dotted-quad parser (four decimal parts, 0–255, no leading zeros); returns the address as an unsigned 32-bit number. */
export function parseIPv4(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

const NON_PUBLIC_V4_PARSED = NON_PUBLIC_V4.map(([base, bits]) => [parseIPv4(base) as number, bits] as const);

function isNonPublicV4(value: number): boolean {
  return NON_PUBLIC_V4_PARSED.some(([base, bits]) => Math.floor(value / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)));
}

/**
 * Full IPv6 parser: hex groups, one `::` compression, an optional dotted IPv4 tail and an optional zone id
 * (`%eth0`). Returns the 16 address bytes, or null when the text isn't a valid IPv6 address.
 */
export function parseIPv6(text: string): Uint8Array | null {
  const address = text.replace(/%[^%]*$/, "");
  if (address.length === 0 || (address.match(/::/g)?.length ?? 0) > 1) return null;

  const words: number[] = [];
  const parseSide = (side: string): number[] | null => {
    if (side === "") return [];
    const groups = side.split(":");
    const out: number[] = [];
    for (const [i, group] of groups.entries()) {
      if (i === groups.length - 1 && group.includes(".")) {
        const v4 = parseIPv4(group);
        if (v4 === null) return null;
        out.push(Math.floor(v4 / 65536), v4 % 65536);
      } else if (/^[0-9a-f]{1,4}$/i.test(group)) {
        out.push(parseInt(group, 16));
      } else {
        return null;
      }
    }
    return out;
  };

  const compressed = address.split("::");
  if (compressed.length === 2) {
    const head = parseSide(compressed[0]);
    const tail = parseSide(compressed[1]);
    // A dotted tail may only end the address
    if (!head || !tail || compressed[0].includes(".") || head.length + tail.length > 7) return null;
    words.push(...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail);
  } else {
    const all = parseSide(address);
    if (!all || all.length !== 8) return null;
    words.push(...all);
  }

  const bytes = new Uint8Array(16);
  words.forEach((word, i) => {
    bytes[i * 2] = word >> 8;
    bytes[i * 2 + 1] = word & 0xff;
  });
  return bytes;
}

const v4FromBytes = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];

const allZero = (bytes: Uint8Array, from: number, to: number): boolean => bytes.subarray(from, to).every((b) => b === 0);

function isNonPublicV6(bytes: Uint8Array): boolean {
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (IPv4-compatible, which also covers :: and ::1)
  if (allZero(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return isNonPublicV4(v4FromBytes(bytes, 12));
  if (allZero(bytes, 0, 12)) return true;
  // 64:ff9b::/96 (NAT64) embeds an IPv4 address in the last 32 bits
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && allZero(bytes, 4, 12)) return isNonPublicV4(v4FromBytes(bytes, 12));
  // 2002::/16 (6to4) embeds an IPv4 address in bits 16–47
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return isNonPublicV4(v4FromBytes(bytes, 2));
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true; // fec0::/10 site-local (deprecated)
  if (bytes[0] === 0xff) return true; // ff00::/8 multicast
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // 2001:db8::/32 documentation
  if (bytes[0] === 0x01 && bytes[1] === 0x00 && allZero(bytes, 2, 8)) return true; // 100::/64 discard
  return false;
}

/** True unless the address is a valid public unicast IPv4 or IPv6 address; anything unparseable counts as non-public. */
export function isNonPublicAddress(address: string): boolean {
  const text = address.trim().replace(/^\[|\]$/g, "");
  const v4 = parseIPv4(text);
  if (v4 !== null) return isNonPublicV4(v4);
  const v6 = parseIPv6(text);
  return v6 === null ? true : isNonPublicV6(v6);
}
