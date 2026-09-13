import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { childLogger } from "@/lib/logger";
import { ImageLoadError, MAX_IMAGE_BYTES } from "@/services/page-jobs";

const log = childLogger("image-fetch");

const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

/** IPv4 ranges that must never be fetched on a user's behalf (loopback, private, link-local, CGNAT, multicast, reserved). */
const BLOCKED_V4: [number, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
].map(([base, bits]) => [ipv4ToInt(base as string), bits as number]);

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

/** True when the address is not a public unicast address. */
export function isNonPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const value = ipv4ToInt(address);
    return BLOCKED_V4.some(([base, bits]) => (value >>> (32 - bits)) === (base >>> (32 - bits)));
  }
  const ip = address.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d) is judged by its IPv4 part
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isNonPublicAddress(mapped[1]);
  return ip === "::" || ip === "::1" || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || ip.startsWith("ff");
}

/** Resolves the URL's host and rejects it when any address it maps to isn't public. */
async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw new ImageLoadError("could not resolve the image host");
  if (addresses.some(isNonPublicAddress)) throw new ImageLoadError("image URLs on private or local networks are not allowed");
}

/** Parses and checks one URL of the fetch chain (the original or a redirect target). */
async function checkedUrl(raw: string, base?: URL): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw new ImageLoadError("invalid image URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ImageLoadError("only http and https image URLs are supported");
  await assertPublicHost(url);
  return url;
}

/**
 * Downloads an image for a new page. Only public http(s) hosts are allowed, including after each redirect
 * (at most MAX_REDIRECTS), the body is capped at MAX_IMAGE_BYTES while streaming, and failures throw
 * ImageLoadError with a message fit for the client (network details are only logged). Sends the URL's origin
 * as referer, which many manga image hosts require.
 */
export async function fetchImage(rawUrl: string): Promise<Buffer> {
  let url = await checkedUrl(rawUrl);
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);

  let res: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      res = await fetch(url, { signal, redirect: "manual", headers: { accept: "image/*", referer: `${url.origin}/` } });
    } catch (err) {
      log.warn({ err, url: url.href }, "Image fetch failed");
      throw new ImageLoadError(err instanceof Error && err.name === "TimeoutError" ? "fetching the image timed out" : "could not fetch the image");
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) break;
    if (hop === MAX_REDIRECTS) throw new ImageLoadError("too many redirects");
    url = await checkedUrl(location, url);
    res = null;
  }

  if (!res) throw new ImageLoadError("could not fetch the image");
  if (!res.ok) throw new ImageLoadError(`image URL returned HTTP ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) throw new ImageLoadError("image too large (max 15 MB)");
  if (!res.body) throw new ImageLoadError("image URL returned no data");

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new ImageLoadError("image too large (max 15 MB)");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
