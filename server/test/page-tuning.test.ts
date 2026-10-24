/**
 * Per-page threshold overrides: stored as given, checked against the limits the Studio shows, marking stale exactly
 * what a change outdates, reaching the cleaning they tune, and travelling with a page's draft copies.
 *
 * Detector confidence reaches the detectors only through a full run, which needs the models; what is pinned here is
 * that it is stored, and that changing it outdates nothing until then.
 */
import { describe, expect, test } from "bun:test";
import { flatFill } from "@/services/inpaint-service";
import { applyTuning, staleStagesFor, tuningError } from "@/shared/page-tuning";
import { PageStore, pageDir, type StageName } from "@/stores/page-store";
import { WorkspaceStore } from "@/stores/workspace-store";
import { call, png, signedIn } from "./harness";

const STAGES: StageName[] = ["ocr", "translate", "clean_text", "clean_sfx", "render"];

/** A Studio page with every stage fresh, as if just run. */
async function studioPage(cookie: string): Promise<string> {
  const workspace = await call<{ id: number }>("POST", "/studio/api/workspaces", { name: `Tuning ${crypto.randomUUID()}` }, { cookie });
  const form = new FormData();
  form.append("files", new File([await png("#ffffff", 120, 160)], "1.png", { type: "image/png" }));
  form.append("start_index", "0");
  const upload = await call<{ pages: { id: string }[] }>("POST", `/studio/api/workspaces/${workspace.body.id}/pages`, form, { cookie });
  const pageId = upload.body.pages[0]!.id;
  await freshen(pageId);
  return pageId;
}

async function freshen(pageId: string): Promise<void> {
  for (const stage of STAGES) await PageStore.setStage(pageId, stage, "fresh");
}

async function stale(pageId: string): Promise<string[]> {
  const rows = await PageStore.listStages(pageId);
  return STAGES.filter((stage) => rows.find((r) => r.stage === stage)?.status === "stale");
}

const tune = (pageId: string, cookie: string, changes: Record<string, number | null>) =>
  call<{ tuning: Record<string, number>; error?: string }>("PATCH", `/studio/api/pages/${pageId}/tuning`, changes, { cookie });

describe("the rules", () => {
  test("each knob has its range, and the whole-number ones take whole numbers", () => {
    expect(tuningError("flat_tolerance", 40)).toBeNull();
    expect(tuningError("flat_tolerance", 97)).toContain("between 0 and 96");
    expect(tuningError("mask_dilate", -1)).toContain("between 0 and 16");
    expect(tuningError("mask_dilate", 2.5)).toContain("whole number");
    expect(tuningError("detect_confidence", 0.35)).toBeNull();
    expect(tuningError("detect_confidence", 0)).toContain("between 0.05 and 0.95");
    expect(tuningError("flat_tolerance", Number.NaN)).not.toBeNull();
  });

  test("a number sets, null clears, and a key left out is kept", () => {
    expect(applyTuning({ flat_tolerance: 30, mask_dilate: 6 }, { flat_tolerance: null, detect_confidence: 0.3 }))
      .toEqual({ mask_dilate: 6, detect_confidence: 0.3 });
  });

  test("only a knob that moved outdates anything, and confidence outdates nothing", () => {
    expect(staleStagesFor({ flat_tolerance: 30 }, { flat_tolerance: 30 })).toEqual([]);
    expect(staleStagesFor({}, { mask_dilate: 6 })).toEqual(["clean_text", "clean_sfx", "render"]);
    expect(staleStagesFor({}, { detect_confidence: 0.3 })).toEqual([]);
  });
});

describe("the route", () => {
  test("stores what is set, shows it with the page, and outdates the cleaning", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    expect((await call("GET", `/studio/api/pages/${pageId}`, undefined, { cookie })).body.tuning).toEqual({});

    const tuned = await tune(pageId, cookie, { flat_tolerance: 40 });
    expect(tuned.status).toBe(200);
    expect(tuned.body.tuning).toEqual({ flat_tolerance: 40 });
    expect(await stale(pageId)).toEqual(["clean_text", "clean_sfx", "render"]);
    expect(await PageStore.repository(pageId).tuning!()).toEqual({ flat_tolerance: 40 });
  });

  test("saving the same value again outdates nothing", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    await tune(pageId, cookie, { mask_dilate: 6 });
    await freshen(pageId);
    expect((await tune(pageId, cookie, { mask_dilate: 6 })).status).toBe(200);
    expect(await stale(pageId)).toEqual([]);
  });

  test("detector confidence is kept for the next run and outdates nothing now", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    expect((await tune(pageId, cookie, { detect_confidence: 0.25 })).body.tuning).toEqual({ detect_confidence: 0.25 });
    expect(await stale(pageId)).toEqual([]);
  });

  test("back to the default leaves nothing stored, so a later change of default reaches the page", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    await tune(pageId, cookie, { flat_tolerance: 40, mask_dilate: 6 });
    const cleared = await tune(pageId, cookie, { flat_tolerance: null, mask_dilate: null });
    expect(cleared.body.tuning).toEqual({});
    expect((await PageStore.findById(pageId))?.tuningJson).toBeNull();
  });

  test("a value out of range is refused and changes nothing, even beside a valid one", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    const refused = await tune(pageId, cookie, { mask_dilate: 6, flat_tolerance: 500 });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toContain("Flat-fill tolerance");
    expect(await PageStore.tuning(pageId)).toEqual({});
    expect(await stale(pageId)).toEqual([]);
  });

  test("a page still being translated can't be tuned, and a reader can't tune at all", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await studioPage(cookie);
    const reader = await signedIn("reader");
    expect((await tune(pageId, reader.cookie, { flat_tolerance: 30 })).status).toBe(403);
    await PageStore.update(pageId, { status: "running" });
    expect((await tune(pageId, cookie, { flat_tolerance: 30 })).status).toBe(409);
  });
});

describe("the cleaning it tunes", () => {
  // Two greys 40 apart, alternating: screentone, as far as the flat-fill check can tell
  const W = 60, H = 60, REGION = { x: 20, y: 20, w: 20, h: 20 };
  function screentone() {
    const source = Buffer.alloc(W * H * 3);
    const pending = new Uint8Array(W * H);
    const ring = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        const inside = x >= REGION.x && x < REGION.x + REGION.w && y >= REGION.y && y < REGION.y + REGION.h;
        const grey = (x + y) % 2 === 0 ? 200 : 240;
        source.fill(inside && x % 3 === 0 ? 10 : grey, p * 3, p * 3 + 3);
        if (inside && x % 3 === 0) pending[p] = 1;
        const near = x >= REGION.x - 8 && x < REGION.x + REGION.w + 8 && y >= REGION.y - 8 && y < REGION.y + REGION.h + 8;
        if (near && !inside) ring[p] = 1;
      }
    }
    return { source, result: Buffer.from(source), pending, ring };
  }

  test("flat fill turns tone down by default, and takes it with the tolerance raised", () => {
    const strict = screentone();
    expect(flatFill(strict.source, strict.result, W, H, strict.pending, strict.ring, REGION)).toBe(false);
    const loose = screentone();
    expect(flatFill(loose.source, loose.result, W, H, loose.pending, loose.ring, REGION, { flatTolerance: 48 })).toBe(true);
  });
});

describe("copies", () => {
  test("a draft is tuned as its chapter page was, and publishing it carries the draft's tuning back", async () => {
    const { cookie } = await signedIn("contributor");
    const series = await call<{ series: { id: number } }>("POST", "/manage/api/series", { title: `Tuning ${crypto.randomUUID()}` }, { cookie });
    const chapter = await call<{ chapter_id: number }>("POST", "/manage/api/chapters", { series_id: series.body.series.id, title: "One" }, { cookie });
    const form = new FormData();
    form.append("files", new File([await png()], "1.png", { type: "image/png" }));
    await call("POST", `/manage/api/chapters/${chapter.body.chapter_id}/pages`, form, { cookie });
    const [origin] = await PageStore.listByChapter(chapter.body.chapter_id);
    await PageStore.setTuning(origin!.id, { flat_tolerance: 40 });

    const sent = await call<{ workspace_id: number }>("POST", `/manage/api/chapters/${chapter.body.chapter_id}/to-studio`, undefined, { cookie });
    const draft = (await WorkspaceStore.pages(sent.body.workspace_id)).find((page) => page.originPageId === origin!.id)!;
    expect(await PageStore.tuning(draft.id)).toEqual({ flat_tolerance: 40 });

    await tune(draft.id, cookie, { flat_tolerance: 60 });
    await Bun.write(`${pageDir(draft.id)}/result.png`, await png("#445566"));
    await PageStore.noteResultChanged(draft.id);
    await PageStore.setStage(draft.id, "render", "fresh");
    expect((await call("POST", `/studio/api/pages/${draft.id}/publish`, undefined, { cookie })).status).toBe(200);
    expect(await PageStore.tuning(origin!.id)).toEqual({ flat_tolerance: 60 });
  });
});
