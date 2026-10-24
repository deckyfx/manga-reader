/**
 * How a page image gets in: an upload (base64 or a data URL) or an address the server downloads from.
 *
 * Every refusal here happens before a connection is opened or a pipeline started, which is what lets this run with
 * no network and no models. The downloads go through an injected resolver, so "DNS says 10.0.0.1" is a fact the
 * test states rather than one it hopes the network will produce. What it cannot do offline is follow a redirect
 * from a public host to a private one; that check shares `request()` with the first hop, which is tested here.
 *
 * The route refuses before decoding when the models aren't ready, so the route tests stand the engines up: the two
 * readiness flags, and two empty model files in a folder of this file's own. The folders are moved, not filled —
 * `bun test` reads server/.env, which on a working checkout points them at the real models.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { bootState } from "@/boot-state";
import { fetchImage, type Resolver } from "@/services/image-fetch";
import { inpaintModelPath } from "@/services/inpaint-service";
import { decodeBase64Image, ImageLoadError, MAX_IMAGE_BYTES } from "@/services/page-jobs";
import { normalisePage } from "@/services/page-pipeline";
import { textSegModelPath } from "@/services/text-seg-service";
import { pageDir, PageStore } from "@/stores/page-store";
import { call, png, signedIn } from "./harness";

/** The message fetchImage refused with, or a note that it didn't refuse with an ImageLoadError. */
async function refusal(url: string, resolve?: Resolver): Promise<string> {
  try {
    await fetchImage(url, resolve);
    return "(fetched)";
  } catch (err) {
    return err instanceof ImageLoadError ? err.message : `(not an ImageLoadError: ${String(err)})`;
  }
}

/** A resolver that answers from a table, and remembers what it was asked. */
function dns(answers: Record<string, string[]>): Resolver & { asked: string[] } {
  const asked: string[] = [];
  const resolve = (async (hostname: string) => {
    asked.push(hostname);
    return (answers[hostname] ?? []).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  }) as Resolver & { asked: string[] };
  resolve.asked = asked;
  return resolve;
}

describe("an upload", () => {
  test("is plain base64 or a data URL, and both decode to the same bytes", () => {
    const bytes = Buffer.from("not really a png, but bytes all the same");
    const base64 = bytes.toString("base64");
    expect(decodeBase64Image(base64)).toEqual(bytes);
    expect(decodeBase64Image(`data:image/png;base64,${base64}`)).toEqual(bytes);
    // Padding may be left off
    expect(decodeBase64Image(base64.replace(/=+$/, ""))).toEqual(bytes);
  });

  test("anything else is refused, including base64 a mail client has wrapped into lines", () => {
    for (const text of ["not base64!", "abcde", "ab=c", "aGVsbG8=\naGVsbG8=", "aGVs bG8="]) {
      expect(() => decodeBase64Image(text)).toThrow(ImageLoadError);
    }
  });

  test("is refused by its length, before anything is decoded", () => {
    const limit = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
    expect(() => decodeBase64Image("A".repeat(limit))).not.toThrow();
    expect(() => decodeBase64Image("A".repeat(limit + 4))).toThrow("too large");
  });
});

describe("a download", () => {
  test("only http and https, with no credentials and an address that parses", async () => {
    expect(await refusal("file:///etc/passwd")).toBe("only http and https image URLs are supported");
    expect(await refusal("ftp://example.com/a.png")).toBe("only http and https image URLs are supported");
    expect(await refusal("data:image/png;base64,AAAA")).toBe("only http and https image URLs are supported");
    expect(await refusal("http://user:secret@example.com/a.png")).toBe("image URLs with credentials are not supported");
    expect(await refusal("not a url")).toBe("invalid image URL");
  });

  test("an address on this machine or its network is refused, however it is spelled", async () => {
    const resolve = dns({});
    for (const url of [
      "http://127.0.0.1/a.png",
      "http://[::1]/a.png",
      // These reach the check as 127.0.0.1 or ::ffff:7f00:1, once the URL parser has had them
      "http://2130706433/a.png",
      "http://0x7f.1/a.png",
      "http://[::ffff:127.0.0.1]/a.png",
      "http://169.254.169.254/latest/meta-data/",
      "https://192.168.1.20:8443/a.png",
    ]) {
      expect([url, await refusal(url, resolve)]).toEqual([url, "image URLs on private or local networks are not allowed"]);
    }
    // An address in the URL is judged as it is: no lookup a hostile resolver could answer differently
    expect(resolve.asked).toEqual([]);
  });

  test("a name that resolves to a private address is refused, before anything connects", async () => {
    const resolve = dns({ "images.example": ["10.0.0.7"] });
    expect(await refusal("http://images.example/a.png", resolve)).toBe("image URLs on private or local networks are not allowed");
    expect(resolve.asked).toEqual(["images.example"]);
  });

  test("one private address among public ones is enough to refuse", async () => {
    // Otherwise a host could answer with a public address for the check and connect on the private one
    const resolve = dns({ "cdn.example": ["93.184.216.34", "127.0.0.1"] });
    expect(await refusal("http://cdn.example/a.png", resolve)).toBe("image URLs on private or local networks are not allowed");
  });

  test("a name that doesn't resolve is refused, whether DNS answers nothing or fails", async () => {
    expect(await refusal("http://nowhere.example/a.png", dns({}))).toBe("could not resolve the image host");
    const failing: Resolver = async () => {
      throw new Error("SERVFAIL");
    };
    expect(await refusal("http://broken.example/a.png", failing)).toBe("could not resolve the image host");
  });
});

describe("the Studio's new-page route", () => {
  let cookie: string;
  let modelDir: string;
  const saved = {
    ocrReady: bootState.ocrReady,
    translateReady: bootState.translateReady,
    textSeg: Bun.env.TEXT_SEG_MODELS_DIR,
    inpaint: Bun.env.INPAINT_MODELS_DIR,
  };

  beforeAll(async () => {
    cookie = (await signedIn("contributor")).cookie;
    modelDir = await mkdtemp(join(tmpdir(), "manga-reader-intake-models-"));
    Bun.env.TEXT_SEG_MODELS_DIR = join(modelDir, "textseg");
    Bun.env.INPAINT_MODELS_DIR = join(modelDir, "inpaint");
    for (const file of [textSegModelPath(), inpaintModelPath()]) {
      await mkdir(join(file, ".."), { recursive: true });
      await Bun.write(file, "");
    }
    bootState.ocrReady = true;
    bootState.translateReady = true;
  });

  afterAll(async () => {
    bootState.ocrReady = saved.ocrReady;
    bootState.translateReady = saved.translateReady;
    if (saved.textSeg === undefined) delete Bun.env.TEXT_SEG_MODELS_DIR;
    else Bun.env.TEXT_SEG_MODELS_DIR = saved.textSeg;
    if (saved.inpaint === undefined) delete Bun.env.INPAINT_MODELS_DIR;
    else Bun.env.INPAINT_MODELS_DIR = saved.inpaint;
    await rm(modelDir, { recursive: true, force: true });
  });

  const submit = (body: Record<string, unknown>) => call<{ job_id?: string; cached?: boolean; error?: string }>("POST", "/studio/api/pages", body, { cookie });

  test("takes an image or an address, not both and not neither", async () => {
    expect((await submit({})).status).toBe(422);
    expect((await submit({ image: "AAAA", url: "https://example.com/a.png" })).status).toBe(422);
  });

  test("bytes that aren't an image are refused, not queued", async () => {
    const before = (await PageStore.list(1000)).length;
    const text = await submit({ image: Buffer.from("plain text, not a picture").toString("base64") });
    expect(text.status).toBe(400);
    expect(text.body.error).toBe("image could not be decoded");

    // A PNG cut short: the signature is right and the rest is missing
    const truncated = (await png()).subarray(0, 40);
    expect((await submit({ image: Buffer.from(truncated).toString("base64") })).status).toBe(400);
    expect((await PageStore.list(1000)).length).toBe(before);
  });

  test("a picture with more pixels than the limit is refused, however small its file", async () => {
    // 8000 × 6000 of one colour compresses to almost nothing, and would decode to 192 MB
    const huge = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#ffffff" } }).png().toBuffer();
    expect(huge.byteLength).toBeLessThan(1_000_000);
    const refused = await submit({ image: huge.toString("base64") });
    expect(refused.status).toBe(400);
  });

  test("an address on a private network is refused here as everywhere", async () => {
    const refused = await submit({ url: "http://127.0.0.1:3579/health" });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("image URLs on private or local networks are not allowed");
  });

  test("a page translated before is replayed, whichever way the same image arrives", async () => {
    // The page's identity is a hash of the image *as the pipeline will see it*: upright and flattened
    const image = await png("#204060", 30, 40);
    const normalised = await normalisePage(sharp(image)).png().toBuffer();
    const hash = new Bun.CryptoHasher("sha256").update(normalised).digest("hex");
    const { page } = await PageStore.findOrCreate(hash, "upload");
    await PageStore.update(page.id, { status: "done", cleanSfx: false });
    await mkdir(pageDir(page.id), { recursive: true });
    await Bun.write(join(pageDir(page.id), "result.png"), await png("#ffffff", 30, 40));

    const base64 = Buffer.from(image).toString("base64");
    for (const body of [{ image: base64 }, { image: `data:image/png;base64,${base64}` }]) {
      const replayed = await submit(body);
      expect(replayed.status).toBe(202);
      expect(replayed.body).toEqual({ job_id: page.id, cached: true });
    }
  });

  test("with the models not ready, nothing is even decoded", async () => {
    bootState.ocrReady = false;
    try {
      const refused = await submit({ image: "this is not base64 at all" });
      expect(refused.status).toBe(503);
    } finally {
      bootState.ocrReady = true;
    }
  });
});
