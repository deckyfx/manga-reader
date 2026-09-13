import { ImageLoadError, MAX_IMAGE_BYTES } from "@/services/page-jobs";

const FETCH_TIMEOUT_MS = 20_000;

/**
 * Downloads an image for a new page. Only http(s) is allowed, the body is capped at MAX_IMAGE_BYTES while
 * streaming, and failures throw ImageLoadError with a message fit for the client. Sends the URL's origin as
 * referer, which many manga image hosts require.
 */
export async function fetchImage(url: string): Promise<Buffer> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ImageLoadError("invalid image URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new ImageLoadError("only http and https image URLs are supported");

  let res: Response;
  try {
    res = await fetch(parsed, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "image/*", referer: `${parsed.origin}/` },
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : err instanceof Error ? err.message : String(err);
    throw new ImageLoadError(`could not fetch image: ${reason}`);
  }
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
