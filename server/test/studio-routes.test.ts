/**
 * The Studio routes that edit a page without running a model: region geometry, painted mask layers, stage images,
 * fonts and publish history. What they share is the contract the editor relies on — a change marks exactly the
 * stages it outdates, and a refused change leaves the page as it was.
 *
 * Detection is stood in for by writing mask.png beside the page, the one file the mask routes need from it.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { SESSION_COOKIE } from "@/services/auth";
import { PageStore, pageDir, type StageName } from "@/stores/page-store";
import { app, call, png, signedIn } from "./harness";

const WIDTH = 200;
const HEIGHT = 300;
const ALL_STAGES: StageName[] = ["ocr", "translate", "clean_text", "clean_sfx", "render"];

/** A Studio page of WIDTH × HEIGHT with one text block (1) and one sound effect (2), every stage fresh. */
async function studioPage(cookie: string): Promise<string> {
  const workspace = await call<{ id: number }>("POST", "/studio/api/workspaces", { name: `Routes ${crypto.randomUUID()}` }, { cookie });
  const form = new FormData();
  form.append("files", new File([await png("#ffffff", WIDTH, HEIGHT)], "1.png", { type: "image/png" }));
  form.append("start_index", "0");
  const upload = await call<{ pages: { id: string }[] }>("POST", `/studio/api/workspaces/${workspace.body.id}/pages`, form, { cookie });
  const pageId = upload.body.pages[0]!.id;
  expect((await call("POST", `/studio/api/pages/${pageId}/blocks`, { kind: "text", x: 20, y: 20, w: 80, h: 60, source_text: "あ", translated_text: "A" }, { cookie })).status).toBe(200);
  expect((await call("POST", `/studio/api/pages/${pageId}/blocks`, { kind: "sfx", x: 120, y: 200, w: 40, h: 40 }, { cookie })).status).toBe(200);
  await freshen(pageId);
  return pageId;
}

async function freshen(pageId: string): Promise<void> {
  for (const stage of ALL_STAGES) await PageStore.setStage(pageId, stage, "fresh");
}

/** The stages that are stale, in pipeline order. */
async function stale(pageId: string): Promise<string[]> {
  const rows = await PageStore.listStages(pageId);
  return ALL_STAGES.filter((stage) => rows.find((r) => r.stage === stage)?.status === "stale");
}

/** A PNG of the page's size: white is painted, black is not. */
async function layer(colour: "#ffffff" | "#000000", width = WIDTH, height = HEIGHT): Promise<string> {
  return Buffer.from(await png(colour, width, height)).toString("base64");
}

/** A raw response, for routes that answer with a file rather than JSON. */
async function fetchRaw(path: string, cookie: string): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`, { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } }));
}

describe("moving and reshaping a region", () => {
  test("a text region outdates everything read from it; a sound effect only its cleaning", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);

    const moved = await call("PUT", `/studio/api/pages/${pageId}/blocks/1`, { x: 30, y: 30, w: 90, h: 50 }, { cookie });
    expect(moved.status).toBe(200);
    expect(moved.body.blocks.find((b: { id: number }) => b.id === 1)).toMatchObject({ x: 30, y: 30, w: 90, h: 50 });
    expect(await stale(pageId)).toEqual(ALL_STAGES);

    await freshen(pageId);
    expect((await call("PUT", `/studio/api/pages/${pageId}/blocks/2`, { x: 100, y: 200, w: 50, h: 50 }, { cookie })).status).toBe(200);
    expect(await stale(pageId)).toEqual(["clean_sfx", "render"]);
  });

  test("a region that leaves the page, or a polygon that encloses nothing, is refused and changes nothing", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    const refusals: [Record<string, unknown>, string][] = [
      [{ x: 150, y: 20, w: 60, h: 20 }, "region extends outside the page"],
      [{ x: 20, y: 290, w: 20, h: 20 }, "region extends outside the page"],
      [{ x: 20, y: 20, w: 40, h: 40, shape: { type: "polygon", points: [{ x: 20, y: 20 }, { x: 90, y: 30 }, { x: 30, y: 50 }] } }, "polygon points must lie inside the region's box"],
      [{ x: 20, y: 20, w: 40, h: 40, shape: { type: "polygon", points: [{ x: 20, y: 20 }, { x: 40, y: 40 }, { x: 60, y: 60 }] } }, "polygon has no area (its points lie on one line)"],
    ];
    for (const [body, error] of refusals) {
      const refused = await call("PUT", `/studio/api/pages/${pageId}/blocks/1`, body, { cookie });
      expect([refused.status, refused.body.error]).toEqual([422, error]);
    }
    expect(await stale(pageId)).toEqual([]);
    const detail = await call("GET", `/studio/api/pages/${pageId}`, undefined, { cookie });
    expect(detail.body.blocks.find((b: { id: number }) => b.id === 1)).toMatchObject({ x: 20, y: 20, w: 80, h: 60 });
  });

  test("a bow tie encloses pixels even though its signed area is zero, so it is allowed", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    const bowTie = { type: "polygon", points: [{ x: 20, y: 20 }, { x: 60, y: 60 }, { x: 60, y: 20 }, { x: 20, y: 60 }] };
    expect((await call("PUT", `/studio/api/pages/${pageId}/blocks/1`, { x: 20, y: 20, w: 40, h: 40, shape: bowTie }, { cookie })).status).toBe(200);
  });

  test("a region that isn't there is a 404, and a page still being translated can't be edited", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    expect((await call("PUT", `/studio/api/pages/${pageId}/blocks/99`, { x: 1, y: 1, w: 5, h: 5 }, { cookie })).status).toBe(404);

    await PageStore.update(pageId, { status: "running" });
    const busy = await call("PUT", `/studio/api/pages/${pageId}/blocks/1`, { x: 1, y: 1, w: 5, h: 5 }, { cookie });
    expect([busy.status, busy.body.error]).toEqual([409, "page is still being translated"]);
  });
});

describe("removing a region", () => {
  test("outdates the cleaning and the result, not what the other regions read", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    const removed = await call("DELETE", `/studio/api/pages/${pageId}/blocks/1`, undefined, { cookie });
    expect(removed.status).toBe(200);
    expect(removed.body.blocks.map((b: { id: number }) => b.id)).toEqual([2]);
    expect(await stale(pageId)).toEqual(["clean_text", "clean_sfx", "render"]);

    await freshen(pageId);
    expect((await call("DELETE", `/studio/api/pages/${pageId}/blocks/2`, undefined, { cookie })).status).toBe(200);
    expect(await stale(pageId)).toEqual(["clean_sfx", "render"]);
  });

  test("removing it twice is a 404 the second time", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    expect((await call("DELETE", `/studio/api/pages/${pageId}/blocks/1`, undefined, { cookie })).status).toBe(200);
    expect((await call("DELETE", `/studio/api/pages/${pageId}/blocks/1`, undefined, { cookie })).status).toBe(404);
  });
});

describe("painted mask layers", () => {
  test("need the detector's mask to paint against", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    const refused = await call("PUT", `/studio/api/pages/${pageId}/mask/add`, { image: await layer("#ffffff") }, { cookie });
    expect([refused.status, refused.body.error]).toEqual([409, "page has no detected text mask yet"]);
  });

  test("must be the page's size and an image at all; a refusal stores nothing and outdates nothing", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    await Bun.write(join(pageDir(pageId), "mask.png"), await png("#000000", WIDTH, HEIGHT));

    const wrongSize = await call("PUT", `/studio/api/pages/${pageId}/mask/add`, { image: await layer("#ffffff", 100, 100) }, { cookie });
    expect([wrongSize.status, wrongSize.body.error]).toEqual([422, `mask layer must be ${WIDTH}×${HEIGHT}, the page size`]);
    const notImage = await call("PUT", `/studio/api/pages/${pageId}/mask/add`, { image: Buffer.from("no").toString("base64") }, { cookie });
    expect([notImage.status, notImage.body.error]).toEqual([422, "mask layer must be a valid image"]);

    expect(existsSync(join(pageDir(pageId), "mask-add.png"))).toBe(false);
    expect(await stale(pageId)).toEqual([]);
  });

  test("a painted layer is stored and outdates the cleaning; clearing it removes it and does the same", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    await Bun.write(join(pageDir(pageId), "mask.png"), await png("#000000", WIDTH, HEIGHT));
    const file = join(pageDir(pageId), "mask-erase.png");

    expect((await call("PUT", `/studio/api/pages/${pageId}/mask/erase`, { image: await layer("#ffffff") }, { cookie })).status).toBe(200);
    expect(existsSync(file)).toBe(true);
    expect(await stale(pageId)).toEqual(["clean_text", "clean_sfx", "render"]);

    await freshen(pageId);
    expect((await call("DELETE", `/studio/api/pages/${pageId}/mask/erase`, undefined, { cookie })).status).toBe(200);
    expect(existsSync(file)).toBe(false);
    expect(await stale(pageId)).toEqual(["clean_text", "clean_sfx", "render"]);

    // Clearing a layer that isn't there changes nothing, so it outdates nothing
    await freshen(pageId);
    expect((await call("DELETE", `/studio/api/pages/${pageId}/mask/erase`, undefined, { cookie })).status).toBe(200);
    expect(await stale(pageId)).toEqual([]);
  });

  test("a layer with nothing painted is kept as no file, so the page keeps the detector's mask as it is", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    await Bun.write(join(pageDir(pageId), "mask.png"), await png("#000000", WIDTH, HEIGHT));
    expect((await call("PUT", `/studio/api/pages/${pageId}/mask/add`, { image: await layer("#ffffff") }, { cookie })).status).toBe(200);
    expect((await call("PUT", `/studio/api/pages/${pageId}/mask/add`, { image: await layer("#000000") }, { cookie })).status).toBe(200);
    expect(existsSync(join(pageDir(pageId), "mask-add.png"))).toBe(false);
  });

  test("only the two layers exist", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    expect((await call("DELETE", `/studio/api/pages/${pageId}/mask/detector`, undefined, { cookie })).status).toBe(422);
  });
});

describe("stage images", () => {
  test("a page's own images are served; anything else in or beside its folder is not", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    const original = await fetchRaw(`/studio/api/pages/${pageId}/files/original.png`, cookie);
    expect(original.status).toBe(200);
    expect((await sharp(Buffer.from(await original.arrayBuffer())).metadata()).width).toBe(WIDTH);

    // Listed, but not made yet
    expect((await fetchRaw(`/studio/api/pages/${pageId}/files/result.png`, cookie)).status).toBe(404);

    // Not on the list, whatever is on disk: the page's job record, the server's key, the database
    await Bun.write(join(pageDir(pageId), "notes.txt"), "private");
    for (const file of ["notes.txt", "job.json", "secret.key", "..%2F..%2Focr.db", "%2E%2E%2Fsecret.key"]) {
      const refused = await fetchRaw(`/studio/api/pages/${pageId}/files/${file}`, cookie);
      expect([file, refused.status === 200]).toEqual([file, false]);
    }
  });

  test("need a contributor, like the rest of the Studio", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    const reader = await signedIn("reader");
    expect((await fetchRaw(`/studio/api/pages/${pageId}/files/original.png`, reader.cookie)).status).toBe(403);
  });
});

describe("lettering fonts", () => {
  test("the three faces are served as TrueType; nothing else is", async () => {
    const { cookie } = await signedIn("contributor");
    for (const variant of ["regular", "bold", "italic"]) {
      const font = await fetchRaw(`/studio/api/fonts/${variant}`, cookie);
      expect(font.status).toBe(200);
      expect(font.headers.get("content-type")).toBe("font/ttf");
      // The TrueType signature: version 1.0 of the sfnt table
      expect(Buffer.from(await font.arrayBuffer()).subarray(0, 4).toString("hex")).toBe("00010000");
    }
    expect((await fetchRaw("/studio/api/fonts/comic-sans", cookie)).status).toBe(422);
  });
});

describe("publish history", () => {
  test("lists each publish, serves its snapshot for good, and knows what it doesn't have", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    expect((await call("GET", `/studio/api/pages/${pageId}/history`, undefined, { cookie })).body).toEqual([]);

    await Bun.write(join(pageDir(pageId), "result.png"), await png("#123456", WIDTH, HEIGHT));
    await PageStore.noteResultChanged(pageId);
    expect((await call("POST", `/studio/api/pages/${pageId}/publish`, undefined, { cookie })).status).toBe(200);

    const history = await call<{ revision: number; published_at: string }[]>("GET", `/studio/api/pages/${pageId}/history`, undefined, { cookie });
    expect(history.body.map((h) => h.revision)).toEqual([1]);
    const snapshot = await fetchRaw(`/studio/api/pages/${pageId}/history/1`, cookie);
    expect(snapshot.status).toBe(200);
    expect(snapshot.headers.get("cache-control")).toContain("immutable");

    expect((await fetchRaw(`/studio/api/pages/${pageId}/history/2`, cookie)).status).toBe(404);
    expect((await call("GET", "/studio/api/pages/no-such-page/history", undefined, { cookie })).status).toBe(404);
  });
});
