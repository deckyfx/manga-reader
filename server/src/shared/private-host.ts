/**
 * Whether a host in a URL names somewhere inside the network the client sits on.
 *
 * Browser-safe, like `shared/typeset.ts` and the extractors: the extension imports it to refuse fetching a cover
 * from the user's own machine or LAN, and the tests import the same code rather than a copy of the rules.
 *
 * It classifies **literal addresses only**. A name is always treated as public, because deciding otherwise needs a
 * resolver — and where one exists (the server's `fetchImage`), the address is checked after resolution and pinned
 * for the connection. This is the cheap half of that: it stops the obvious, and it is not a substitute for the
 * server-side check.
 */

/** Groups of four in an IPv4 literal, or nothing when it isn't one. */
function ipv4Parts(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const numbers: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    numbers.push(value);
  }
  return numbers;
}

/** An IPv4 address nobody should be fetched from: this machine, this link, or a private network. */
function privateIpv4(parts: number[]): boolean {
  const [a = 0, b = 0] = parts;
  if (a === 0 || a === 127) return true;                       // unspecified, loopback
  if (a === 10) return true;                                   // private
  if (a === 172 && b >= 16 && b <= 31) return true;            // private
  if (a === 192 && b === 168) return true;                     // private
  if (a === 169 && b === 254) return true;                     // link-local, and the cloud metadata address
  if (a === 100 && b >= 64 && b <= 127) return true;           // carrier-grade NAT
  if (a >= 224) return true;                                   // multicast and reserved, up to broadcast
  return false;
}

/**
 * The same for IPv6, including the two forms that look public at a glance: `fe80::/10` link-local, and an IPv4
 * address written inside an IPv6 one (`::ffff:192.168.1.1`), which reaches exactly the host it names.
 */
function privateIpv6(host: string): boolean {
  const address = host.toLowerCase();
  if (address === "::" || address === "::1") return true;
  // An IPv4 address carried inside an IPv6 one reaches exactly that IPv4 host, in either of the two spellings:
  // the dotted tail somebody types, and the hex pairs `URL.hostname` normalises it to — `::ffff:192.168.1.1`
  // arrives here as `::ffff:c0a8:101`, which is the form that actually has to be caught
  const dotted = /^::(?:ffff:(?:0{1,4}:)?)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(address);
  if (dotted) {
    const parts = ipv4Parts(dotted[1] ?? "");
    // Something shaped like a mapped address but holding no valid IPv4 is not worth fetching from either
    return parts === null || privateIpv4(parts);
  }
  const hex = /^::(?:ffff:(?:0{1,4}:)?)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (hex) {
    const high = Number.parseInt(hex[1] ?? "", 16);
    const low = Number.parseInt(hex[2] ?? "", 16);
    return privateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  if (/^f[cd][0-9a-f]{0,2}:/.test(address)) return true;       // fc00::/7, unique local
  if (/^fe[89ab][0-9a-f]?:/.test(address)) return true;        // fe80::/10, link-local
  return false;
}

/**
 * Whether this host is somewhere on the client's own network. `hostname` is taken as `URL.hostname` gives it —
 * IPv6 without brackets — but brackets are tolerated so a caller can pass either.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;

  const ipv4 = ipv4Parts(host);
  if (ipv4) return privateIpv4(ipv4);
  if (host.includes(":")) return privateIpv6(host);
  // A name: this can't say, and says so by treating it as public
  return false;
}
