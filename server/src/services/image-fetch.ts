import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { isNonPublicAddress } from "@/lib/ip-address";
import { childLogger } from "@/lib/logger";
import { ImageLoadError, MAX_IMAGE_BYTES } from "@/services/page-jobs";

const log = childLogger("image-fetch");

const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

export interface ResolvedAddress {
  address: string;
  family: number;
}

/** DNS resolution used for every connection; injectable so tests can simulate hostile DNS. */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

const systemResolver: Resolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/** Hostname or IP literal from a URL, without IPv6 brackets. */
const hostOf = (url: URL): string => url.hostname.replace(/^\[|\]$/g, "");

/** Resolves the host and keeps only public addresses; throws when any address is non-public or none resolve. */
async function publicAddresses(hostname: string, resolve: Resolver): Promise<ResolvedAddress[]> {
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await resolve(hostname).catch((err: unknown) => {
      log.warn({ err, hostname }, "Image host lookup failed");
      return [];
    });
  if (addresses.length === 0) throw new ImageLoadError("could not resolve the image host");
  if (addresses.some((a) => isNonPublicAddress(a.address))) throw new ImageLoadError("image URLs on private or local networks are not allowed");
  return addresses;
}

/**
 * DNS lookup for the http(s) agent: validates the addresses at connect time and connects to exactly those,
 * so a DNS answer can't change between the check and the connection (DNS rebinding).
 */
function pinnedLookup(resolve: Resolver): LookupFunction {
  return (hostname, options, callback) => {
    publicAddresses(hostname, resolve).then(
      (addresses) => {
        if ((options as { all?: boolean }).all) {
          (callback as unknown as (err: null, addresses: ResolvedAddress[]) => void)(null, addresses);
        } else {
          callback(null, addresses[0].address, addresses[0].family);
        }
      },
      (err: Error) => callback(err as NodeJS.ErrnoException, "", 0),
    );
  };
}

/** Parses a URL of the fetch chain (the original or a redirect target) and checks its scheme. */
function parseUrl(raw: string, base?: URL): URL {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw new ImageLoadError("invalid image URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ImageLoadError("only http and https image URLs are supported");
  // user:pass@ would be sent as Basic auth (in plain text over http); page images never need it
  if (url.username || url.password) throw new ImageLoadError("image URLs with credentials are not supported");
  return url;
}

/** Origin and path only, for logs: the full URL can carry credentials or signed query parameters. */
const logUrl = (url: URL): string => `${url.origin}${url.pathname}`;

/** One GET over a connection pinned to validated public addresses; resolves once response headers arrive. */
async function request(url: URL, resolve: Resolver, signal: AbortSignal): Promise<IncomingMessage> {
  // IP literals skip DNS, so the pinned lookup never sees them: check them here, for the first URL and every redirect
  if (isIP(hostOf(url))) await publicAddresses(hostOf(url), resolve);
  return new Promise((resolvePromise, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.get(url, {
      // No keep-alive agent: every request must go through the pinned lookup
      agent: false,
      lookup: pinnedLookup(resolve),
      signal,
      headers: { accept: "image/*", referer: `${url.origin}/`, "user-agent": "web-ocr" },
    }, resolvePromise);
    req.on("error", reject);
  });
}

/** Maps transport failures to a client-safe ImageLoadError; the details are only logged. */
function toLoadError(err: unknown, url: URL, signal: AbortSignal): ImageLoadError {
  if (err instanceof ImageLoadError) return err;
  log.warn({ err, url: logUrl(url) }, "Image fetch failed");
  return new ImageLoadError(signal.aborted ? "fetching the image timed out" : "could not fetch the image");
}

/**
 * Downloads an image for a new page. Only public http(s) hosts are reachable: every connection (including
 * each of at most MAX_REDIRECTS redirects) is pinned to addresses validated at connect time. The body is capped
 * at MAX_IMAGE_BYTES while streaming, the whole download has one deadline, and every failure is an
 * ImageLoadError with a client-safe message. Sends the URL's origin as referer, which many manga hosts require.
 */
export async function fetchImage(rawUrl: string, resolve: Resolver = systemResolver): Promise<Buffer> {
  let url = parseUrl(rawUrl);
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);

  let res: IncomingMessage | null = null;
  for (let hop = 0; ; hop++) {
    try {
      res = await request(url, resolve, signal);
    } catch (err) {
      throw toLoadError(err, url, signal);
    }
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (status < 300 || status >= 400 || !location) break;
    res.destroy();
    if (hop === MAX_REDIRECTS) throw new ImageLoadError("too many redirects");
    url = parseUrl(location, url);
  }

  const status = res.statusCode ?? 0;
  if (status < 200 || status >= 300) {
    res.destroy();
    throw new ImageLoadError(`image URL returned HTTP ${status}`);
  }
  if (Number(res.headers["content-length"] ?? 0) > MAX_IMAGE_BYTES) {
    res.destroy();
    throw new ImageLoadError("image too large (max 15 MB)");
  }

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of res) {
      const piece = chunk as Buffer;
      total += piece.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        res.destroy();
        throw new ImageLoadError("image too large (max 15 MB)");
      }
      chunks.push(piece);
    }
  } catch (err) {
    throw toLoadError(err, url, signal);
  }
  if (total === 0) throw new ImageLoadError("image URL returned no data");
  return Buffer.concat(chunks);
}
