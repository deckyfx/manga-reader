# Dashboard & Studio — Plan (server-bun)

Status: **phases 0–1 built** (PR #15; see the phase status notes in section 10) · Written 2026-09-13, updated 2026-09-14 · Supersedes the C#-era studio and portal plans (ASP.NET + SolidJS, burn via `window.postMessage`), since removed.

Builds on the page pipeline from PR #14 (`bun run page …`, `POST /api/translate-page`, `src/services/page-pipeline.ts`).

---

## 1. Goals

1. **Polish a job and push it back.** Open a page the extension translated, tweak it with studio tools, and publish. The extension replaces the image on the page the user is still viewing.
2. **Manual translation works.** Organise work as volume → chapter → pages, using the same pipeline and the same studio tools.

What the studio must support:

- **Translate / retranslate** — pick or draw custom regions; OCR and translate them; edit translations by hand (terminology fixes).
- **Clean / inpaint** — edit or create custom areas to clean; redo cleaning stages.
- **Patches** — edit and create text overlays (including re-adding SFX lettering): move, resize, rotate, font, size, colours, stroke.
- **Compare stages** — show any stage's result next to another (e.g. before vs after cleaning).

---

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Every page keeps the state of every stage.** Auto pipeline and manual work use the same stages. After an auto run, the user can go back to any stage and tweak from there. | Tweaking must never require starting over; comparison needs every stage's output. |
| D2 | **Placing text and burning it are separate steps.** The studio shows placed text as editable overlays first; the user burns when satisfied. The auto pipeline places and burns in one go. | Editing text on an already-burned image means re-cleaning; keeping them apart makes text edits instant. |
| D3 | **The server burns, and the browser previews with the same layout code.** The typesetter (opentype.js + hyphen, pure JS) is shared with the client, so the overlay matches the burned result. | manga-reader burned in the browser with different wrapping/rotation than the editor showed. |
| D4 | **SQLite + Drizzle is the source of truth.** The job folder only holds images. Uses the existing embedded auto-migration. | Today `blocks.json` and DB rows are two drifting copies. |
| D5 | **Build a vertical slice first** (section 9, phase 0): translate a page → edit the result in the studio → publish → the extension replaces the image in the open tab. | Proves the full loop and the framework before investing in rich tools. |
| D6 | **Live replace only while the user stays on the page.** The extension listens for updates to pages translated in the current tab and stops when the tab navigates away. No background watching. | Keeps the channel simple; nothing to persist or clean up. |
| D7 | **Canvas library: Fabric.js v7** — *proposed, awaiting confirmation* (comparison in section 3). | Built-in text editing and freehand brush; reuses manga-reader's studio code. |
| D8 | **Two top-level areas.** Everything for editing lives under `/studio/` (UI `/studio/…`, API `/studio/api/…`). Book management and the reader live under `/read/` (UI `/read/…`, API `/read/api/…`). Extension-facing routes stay under `/api/…`. | Clear ownership: the studio edits pages, the read area organises and reads books; each area's UI and API can evolve independently. |

---

## 3. Canvas library: Fabric.js vs Konva

What the studio needs: stacked stage images, a mask brush (add/erase) exported as PNG, draggable/resizable/rotatable regions and text, in-place text editing, zoom/pan on large pages (~1–2 MP), and React 19 integration.

| Need | Fabric.js v7 | Konva (+ react-konva) |
|---|---|---|
| Move / resize / rotate handles | Built in on every object | `Transformer` node, attach per selection |
| Edit text in place | Built in (`IText` / `Textbox`) | Not built in — overlay a positioned `<textarea>` yourself |
| Freehand mask brush | Built in (`PencilBrush`, erasing via composite ops) | Build from `Line` + pointer events |
| Layers (image / mask / text) | No layer concept — groups or stacked canvases | Native `Layer`s, each cacheable |
| React integration | Imperative; wrap in hooks + store | Declarative components via react-konva |
| TypeScript | Written in TS (v6+) | Written in TS |
| Zoom / pan | Viewport transform | Stage scale / position |
| Reuse from manga-reader | Tools, popover, canvas setup (Fabric 7) | None |
| Export mask PNG | `toDataURL` of a mask-only canvas | `layer.toDataURL` |

**Verdict: Fabric.js** for this project. The two hardest interactions — typing into rotated text and painting masks — come built in, and manga-reader's tools port over. Konva's advantages (declarative React, native layers) are real, but the studio has only a few long-lived layers, which stacked Fabric canvases handle. Wrap Fabric in a thin typed layer (hooks + zustand store) so components never touch Fabric objects directly.

---

## 4. Stage state model

Stages in order (each writes into `data/pages/<page_id>/`):

| Stage | Artifacts | Notes |
|---|---|---|
| `original` | `original.png` | Uploaded page |
| `detect` | `mask.png`, blocks in DB | Text mask + text/sfx blocks |
| `ocr` | `crops/<block>.png`, source text in DB | |
| `translate` | translated text in DB | |
| `clean_text` | `clean-text.png` | Bubbles and captions |
| `clean_sfx` | `clean-sfx.png` | Optional |
| `layout` | layout per block in DB (font size, lines, area) | Text placed, **not burned** (D2) |
| `burn` | `patches/<block>.png`, `result.png` | Server render |

Each page stores per-stage state: `status` (`fresh` · `stale` · `error`) and `updated_at`. A stage with no row hasn't run yet; a page being processed shows `queued` / `running` on the page itself. (Recording the page revision each stage was produced at is still planned.)

**Invalidation:** an edit marks downstream stages `stale`. Nothing is deleted, so the last outputs stay viewable and comparable until the user re-runs.

| Edit | Marks stale |
|---|---|
| Add / move / delete a region or block | ocr (that block), clean, layout, burn |
| Edit source text | translate (that block), layout, burn |
| Edit translation | layout, burn |
| Edit mask (add/erase) or toggle cleaning | clean, burn |
| Edit text style / position / rotation | burn |

**Revisions:** publishing increments `pages.revision` and copies `result.png` to `history/<rev>.png` (keep the last N, configurable) for rollback and before/after comparison across publishes.

---

## 5. Data model (Drizzle / SQLite)

- **`pages`** — id, `chapter_id` (null = Inbox for extension jobs), `sort_order`, `source` (`extension` · `upload`), `source_url`, `image_src`, `revision`, `created_at`, `updated_at`. Replaces `page_translation_jobs`; drops the `image_hash` UNIQUE constraint so the same image can appear in several chapters (keep the hash as a non-unique lookup for the extension's reuse cache).
- **`page_stages`** — `page_id`, `stage`, `status`, `error`, `revision`, `updated_at` (unique on page + stage).
- **`page_blocks`** — id, `page_id`, `kind` (`text` · `sfx` · `patch`), `region` (JSON: rect / ellipse / polygon points), `include` (clean), `source_text`, `translated_text`, `layout` (JSON: font size, lines, area — from the layout stage), `style` (JSON overrides: font, size, fill, stroke, align, line height, rotation, box, manual lines), `sort_order`. Replaces `page_translation_logs` and the `text_seg_blocks` JSON column.
- **Mask layers** — `mask-add.png` / `mask-erase.png` in the page folder; effective mask = detector ∪ add − erase.
- **`settings`** — persisted key/value (translation engine, inpaint engine, render defaults) instead of in-memory only.
- Existing `volumes` / `chapters` stay; `chapters.pages_dir` is dropped once pages link by `chapter_id`.

Migration: generate with `bun run db:generate`, embedded automatically. Existing jobs can be migrated into `pages` or simply dropped (dev data only) — decide at phase 0.

---

## 6. Pipeline changes (server)

Refactor `PagePipeline` so every stage can run for the whole page or for selected blocks, and reads/writes the DB (D4):

- `detect()` — full page; plus `addBlock(region)` to create a block manually without re-detecting.
- `ocr(blockIds?)`, `translate(blockIds?)`.
- `clean(kind, blockIds?)` — builds the effective mask (section 5); re-cleans only the selected areas and composites them into the existing clean image.
- `layout(blockIds?)` — places text (respects style overrides and manual lines); no image output.
- `burn(blockIds?)` — renders changed patches only, composites all patches onto the latest cleaned page → `result.png`.
- `autoRun()` — detect → ocr → translate → clean text (→ sfx) → layout → burn, same as today's route.
- Every run goes through one page job queue and emits the existing `PageJobEvent` stream, so the studio shows progress the same way the extension does.
- Extract the typesetter's layout into a module the client can import (D3): no Node/Bun APIs in the layout path; font loaded from `/assets/fonts/…`.

---

## 7. Routes & API (Eden-typed)

Three route areas (D8). Each is its own Elysia plugin with its own prefix, so the SPA fallback never swallows an API path.

| Area | UI | API | Plugin |
|---|---|---|---|
| Studio (editing) | `/studio/…` | `/studio/api/…` | `src/plugins/studio/` |
| Read (books + reader) | `/read/…` | `/read/api/…` | `src/plugins/read/` |
| Extension | — | `/api/…` (health, ocr, analyze, translate-page, live) | `src/api.ts` |

The current `/api/portal/*` routes and the `/`, `/library`, `/studio/:id` client routes are replaced by these; `route-spa.ts` serves the SPA for `/studio/*` and `/read/*` only.

**Read API** (`/read/api`) — book management:
- `GET/POST/PUT/DELETE /read/api/volumes[/:id]`, `/read/api/chapters[/:id]` (moved from portal)
- `GET /read/api/chapters/:id/pages`, `POST /read/api/chapters/:id/pages` (images or ZIP), `PUT /read/api/chapters/:id/pages/reorder`
- `PUT /read/api/pages/:id` — move an Inbox page into a chapter, rename, reorder
- `GET /read/api/pages/:id/image` — latest published result (falls back to original) for the reader

**Studio API** (`/studio/api`) — editing:
- `GET /studio/api/inbox` — extension pages not yet in a chapter
- `GET /studio/api/pages/:id` — page, stage states, blocks
- `GET /studio/api/pages/:id/stages/:stage` — stage image (original, mask, overlay, clean-text, clean-sfx, result); `…/history/:rev`
- `POST/PUT/DELETE /studio/api/pages/:id/blocks[/:blockId]`
- `PUT /studio/api/pages/:id/mask` — add/erase layers
- `POST /studio/api/pages/:id/run` — `{ stage: "ocr" | "translate" | "render", block_ids? }` → page detail (synchronous for now). Planned: `stage: "auto"` returning `{ job_id }` with progress via the same `PageJobEvent` stream
- `POST /studio/api/pages/:id/publish` — revision++, snapshot, notify live listeners
- `POST /studio/api/chapters/:id/run` — batch auto-run a chapter's pages

**Extension API** (`/api`, exported in `src/api.ts` for Eden):
- `POST /api/translate-page` — response `{ job_id, cached }`; the job id is the Studio page id. Planned: send `page_url` and `image_src` with the job
- `GET /api/translate-page/:id/live` — SSE, stays open while the tab is on the page; emits `{ type: "page-updated", page_id, revision, result_url }`

---

## 8. UI (React)

Client routes:

| Route | Screen |
|---|---|
| `/studio` | Inbox (extension pages) + recently edited pages |
| `/studio/pages/:id` | Studio editor for one page |
| `/studio/chapters/:id` | Studio editor opened on a chapter (page strip on the left) |
| `/read` | Library: volumes and chapters |
| `/read/volumes/:id`, `/read/chapters/:id` | Book management: chapters, page upload, reorder |
| `/read/chapters/:id/pages/:n` | Reader (published results, next/prev page) |

### Studio editor (Fabric)

Layout: left page list (chapter thumbnails / Inbox) · centre canvas with viewport zoom & pan · right block panel · top stage bar. Left and right panels collapsible.

- **Stage viewer & compare** — pick one or two stages. Two stages render side by side with the **earlier stage always on the left**, or as a swipe slider, or a quick toggle. Stale stages are marked.
- **Regions** — rectangle / ellipse / polygon tools from manga-reader, with resize handles, saved to `page_blocks`. Auto-detect and reading-order sort kept.
- **Block panel** — source text, translation (inline edit for terminology), kind (text / sfx / patch), include-in-clean, per-block OCR / translate / clean / layout buttons, thumbnails.
- **Mask brush** — add / erase over the clean stage; "re-clean selection".
- **Text overlays** — placed text shown as Fabric textboxes from the layout stage (D2); move / resize / rotate handles; style popover (font, size, fill, stroke, align, line height); free `patch` blocks for re-lettering SFX; **Burn** button renders on the server.
- **Publish** — bumps revision; connected extension tabs replace the image.
- **Undo / redo** — command history covering add, move, resize, rotate, style and delete (not just additions); unsaved-changes guard; keyboard shortcuts (tools, undo/redo, burn, next/prev page).
- Fonts: Anime Ace (bundled), plus Nunito / ToonTime only if their licences allow bundling.

---

## 9. Extension live replace (in-page)

1. User translates an image; the extension receives `job_id`, which is the page id (sending `page_url` and `image_src` with the job is planned).
2. After swapping the image, the content script tags the `<img>` with `data-socr-job-id` and opens `GET /api/translate-page/:id/live`. One stream per translated page; it closes when the image leaves the document or the page unloads (D6).
   - Catch-up on connect: the server keeps no event history, so a publish between the swap and the stream connecting would be missed. To prevent that, the live route subscribes first, then sends the page's current revision as a `page-updated` event (when it's above 0). The tab records the revision it shows (from `?rev=` in the result URL, 0 for a first translation) and only swaps for a newer one, so the catch-up event and any duplicate delivery are harmless.
3. Studio publish → server emits `page-updated` to that page's live listeners → the content script sets `img.src = <server>/<result_url>?rev=N`.
4. The extension's result panel gets an **Open in Studio** link (`<server>/studio/pages/:id`).
5. Remove the dead `postMessage` relay (`web-ocr:image-updated`, `ImageUpdatedMsg`, `ImageUpdatedRelayMsg`, `replacePageImages`).

---

## 10. Phases

| # | Deliverable | Done when |
|---|---|---|
| **0** | **Framework slice** (D5). Server: `/studio` and `/read` plugin skeletons (D8) replacing `/api/portal`; `pages` + `page_stages` + `page_blocks` minimal schema; pipeline writes to DB; stage image routes; `publish`; live SSE channel. Extension: tag image, live channel, `page-updated` swap, Open in Studio link. Studio: open a page, stage viewer + compare, edit a block's translation, re-run render (splitting it into layout and burn is phase 4), publish. | Translate a page in the browser → edit one translation in the studio → publish → the open tab shows the new image without reloading. |
| 1 | Stage state & partial re-runs: per-block OCR / translate / clean / layout / burn, stale marking, revision history + rollback. | Editing any block re-runs only what's needed; stale stages visible. |
| 2 | Canvas studio: Fabric wrapper, region tools, block editing, undo / redo, zoom / pan. | Draw, resize, delete regions; OCR + translate a new region. |
| 3 | Mask editing & re-clean selection; SFX include toggles. | Paint a missed area and re-clean just that area. |
| 4 | Text overlays: shared client layout, style overrides, rotate / resize, free patches, manual burn. | Overlay matches the burned result; SFX re-lettered. |
| 5 | `/read`: volumes / chapters / pages management, ZIP upload, reorder, move Inbox pages into chapters, reader view; batch auto-run per chapter from the studio with progress; export chapter. | A chapter goes from ZIP to translated pages and reads end to end in `/read`. |
| later | Terminology glossary per volume; auth if exposed beyond localhost; self-check & regression set (see `TODO.txt`). | |

### Phase 0 breakdown

Start after PR #14 (and its CodeRabbit fixes) is merged; branch `feat/studio-framework` from `master`.

**Schema** (`src/db/schema.ts`, then `bun run db:generate`)
- `pages`: `id` (a generated UUIDv7; the extension's job id is this page id), `image_hash` (a separate column for the extension's reuse cache), `source`, `width`, `height`, `status`, `clean_sfx`, `revision`, `created_at`, `updated_at`. `image_hash` is unique for now; making it non-unique so the same image can appear in several chapters is phase 5 (section 5). Studio edits and live listeners address pages by `id`, never by hash.
- `page_stages`: `page_id`, `stage`, `status` (`fresh | stale | error`; queued/running live on the page, see section 4), `file` (relative to the job folder, nullable), `error`, `updated_at`; unique on (`page_id`, `stage`).
  - Canonical stage ids, as implemented: `detect | ocr | translate | clean_text | clean_sfx | render`. Splitting `render` into `layout` and `burn` is phase 4; until then, `layout` and `burn` elsewhere in this plan refer to that future split.
  - Artifacts per stage, as served by `GET /studio/api/pages/:id/files/:file`:

    | Stage | Files |
    |---|---|
    | `detect` | `original.png` (page input), `mask.png`, `overlay.png` |
    | `ocr` | `crops/<block>.png` (not served) |
    | `clean_text` | `clean-text.png` |
    | `clean_sfx` | `clean-sfx.png` |
    | `render` | `result.png`, `render-overlay.png`, `patches/<block>.png` (not served) |
- `page_blocks`: `page_id`, `idx`, `kind`, `box` / `bubble` (JSON), `source_text`, `translated_text`, `clean` (bool), `layout` (JSON), `style` (JSON, nullable); unique on (`page_id`, `idx`).
- The old `page_translation_jobs` / `page_translation_logs` stay until the migration question in §12 is decided.

**Server**
- `src/stores/page-store.ts`: a repository over the three tables (`upsertPage`, `setStage`, `markStale(from)`, `saveBlocks`, `updateBlock`, `bumpRevision`).
- `page-pipeline.ts`: every stage writes through `PageStore`, and `render` is split into `layout` (saved to `page_blocks.layout`) and `burn` (reads the saved layout). `route-translate-page.ts` stops calling `persistBlocks`.
- `src/stores/page-live-channel.ts`: per-page subscribers with a typed `PageLiveEvent` (`page-updated {page_id, revision, result_url}`).
- `src/plugins/studio/`, prefix `/studio/api`:
  - `GET /pages`, `GET /pages/:id` (page, stages, blocks)
  - `GET /pages/:id/stages/:stage/image`
  - `PATCH /pages/:id/blocks/:idx` (translation) → marks render stale; re-render with `POST /pages/:id/run { stage: "render" }`
  - `POST /pages/:id/publish` → bump revision, emit `page-updated`
- `src/plugins/read/`: `/read/api` skeleton only.
- Extension API (`src/api.ts`): `GET /api/translate-page/:id/live` (SSE); `GET /api/translate-page/:id/result` accepts `?rev=` so the extension bypasses the cache.
- `index.ts`: drop `portalPlugin`, use `studioPlugin` and `readPlugin`. `route-spa.ts`: exclude `/studio/api` and `/read/api`, but still serve the SPA for `/studio/*` and `/read/*`.

**Studio UI** (`client/`)
- Remove the portal-backed pieces: `JobsPage`, `StudioPage`, `BubbleCanvas`, `TextSegDetail`, `StudioToolbar`, `stores/studio.ts`, `client/api`. `LibraryPage` returns in phase 5.
- Eden client for `/studio/api`.
- `/studio`: a page list (thumbnail, stage status, updated time).
- `/studio/pages/:id`:
  - stage picker with an A/B compare slider (e.g. `original` vs `clean_text`)
  - block list with inline translation edit, then Re-burn
  - Publish button showing the current revision

**Extension**
- `content.ts`: tag the translated `<img>` with `data-socr-job-id`, then open `EventSource(${serverUrl}/api/translate-page/:id/live)` (the configured translation server's origin, like the Studio link) while the tab stays open. On `page-updated`, swap `src` to `/result?rev=N`.
- Add an "Open in Studio" action on the translated image (`${serverUrl}/studio/pages/:id`).
- Regenerate Eden types (`bun run typecheck`) and bump the minor version.

**Verify**: in-process `api.handle()` tests for the studio routes and the live SSE, then the user's browser check (translate → edit → publish → the tab updates).

**Status (2026-09-13, branch `feat/studio-framework`)**: built, and the in-process checks pass (studio routes, a real re-render of sample page 14, live SSE publish). The browser check is still to do. It differs from the breakdown above in these ways:
- `render` stays one stage; splitting it into `layout` and `burn` waits for phase 4 (manual burn).
- The live stream is `GET /api/translate-page/:id/live`, and the page id is the job id.
- Old `page_translation_jobs` / `page_translation_logs` rows are not migrated. The tables are untouched and unused by the Studio; pages translated before this change must be translated again to appear.
- `PagePipeline` takes a `JobRepository`: the CLI keeps `blocks.json` and the server writes blocks to SQLite. They never share pages: the CLI works in `data/pages/work/<name>` and the server in `data/jobs/<page id>`, so each page has one authoritative block store. For server pages that's SQLite (D4); CLI work folders are scratch copies for tuning stages.
- The `/read` UI is a placeholder page; `/read/api/volumes` is the only reader route.

### Phase 1 status (2026-09-14, same branch)

Built:
- **Runs:** `POST /studio/api/pages/:id/run { stage: "ocr" | "translate" | "render", block_ids? }`. OCR and translate can target single blocks; render always does the whole page. A run marks its stage fresh and the stages after it stale (ocr → translate + render, translate → render). A run only marks its stage fresh when it covered every block the stage applies to: all text blocks for OCR, all text blocks with source text for translate, and always for render, which runs for the whole page. A block-scoped run leaves the stage's status as it was, so a stale stage stays stale until every block is re-run (e.g. Translate all); later stages are still marked stale. Tracking freshness per block is still planned (`TODO.txt`).
- **Edits:** `PATCH …/blocks/:idx` takes `source_text` and/or `translated_text`. A source edit marks translate and render stale; a translation edit marks render stale.
- **History:** every publish snapshots `result.png` to `history/<rev>.png` and keeps the last 10. `GET …/history` and `GET …/history/:revision` read them. `POST …/rollback { revision }` restores a snapshot, publishes it as a new revision and marks render stale. Rollback is image-only by design: blocks keep their current text, so the next re-render replaces the restored image with the current text. That's the intended way back after a rollback; to keep the old wording, edit the blocks before re-rendering. Restoring block text along with the image would need per-revision block snapshots, which aren't stored yet.
- **Editor:**
  - editable source text
  - per-block Re-OCR and Re-translate
  - Translate all
  - buttons highlighted when their stage is stale
  - a history strip with thumbnails and restore

Differences from the plan:
- Runs are synchronous JSON calls, with no job id or event stream yet.
- Staleness is tracked per stage, not per block.
- Rollback restores only the image; blocks keep their current text.
- Per-block clean, layout and burn wait for phases 3–4.

Verified: the in-process route checks pass, including a real re-render, history pruning and rollback. Per-block OCR and translate against loaded models haven't been exercised yet; they need the running server.

---

### Phase 2 design (2026-09-14, branch `feat/studio-canvas`)

Library: Fabric.js 7.4.0 (D7 confirmed: manga-reader's studio is Fabric).

**Server: block geometry API**, each call under the per-page lock and refused (409) while the page is queued or running:
- `POST /studio/api/pages/:id/blocks` `{ kind: "text" | "sfx", x, y, w, h, shape?, include? }` adds a region with the next free index.
- `PUT …/blocks/:idx` `{ x, y, w, h, shape? }` moves, resizes or reshapes it, and clears its render.
- `DELETE …/blocks/:idx` removes it.
- Shapes: `rect` (the default, not stored) · `ellipse` · `polygon` with page-pixel points. They're stored in `page_blocks.shape_json` (migration `0004_block_shapes`). The box always bounds the shape and is what OCR crops and cleaning use.
- Validation (422 otherwise):
  - the box must lie inside the page
  - polygon points must lie inside the box
  - a polygon needs at least 3 points that enclose some area (all points on one line are rejected)
  - self-intersecting polygons are accepted on purpose: the stages work on the bounding box, and rejecting them would discard a region drawn by clicking around a bubble
- Stale marking (applied in the same transaction as the change):
  - adding a text block, or changing its geometry in any way (moving, resizing or changing its shape), marks `ocr`, `translate`, `clean_text`, `clean_sfx` and `render`, since the crop OCR reads from has changed (the sound-effect pass cleans on top of `clean-text.png`)
  - an sfx block marks `clean_sfx` and `render`
  - deleting marks the clean stage(s) and `render`: `clean_text` and `clean_sfx` for a text block, `clean_sfx` for a sound effect

**Client canvas** (`client/studio/canvas/`): Fabric stays behind a thin typed layer, so components never touch Fabric objects directly.
- **Lifecycle:** create the `<canvas>` in an effect that's safe under StrictMode (dispose on cleanup), keep the instance in a ref, and resize with a ResizeObserver.
- **Viewport:** the page image is the non-selectable background at page scale 1. Zoom and pan use `viewportTransform`: wheel zoom via `zoomToPoint`, space-drag or middle-drag to pan, and fit-to-screen. Pointer positions use scene coordinates, so region geometry is always in page pixels.
- **Conversion:** one module, `regionToFabric` / `fabricToGeometry`. Polygon math goes through `calcTransformMatrix` and `pathOffset`, so moved, scaled or rotated shapes convert correctly. Objects carry `blockId` only; server data stays the source of truth.
- **Tools:** select · rect · ellipse · polygon, as handlers with attach/detach. Draw tools don't start a new shape on top of an existing region. A polygon finishes on Enter, a double-click or clicking the first point; Escape cancels.
- **Editing:** resize and move controls are on. `object:modified` sends `PUT`, a draw sends `POST`, and Delete/Backspace sends `DELETE`. The rendered blocks come from each response.
- **Undo / redo:** a command stack of inverse API calls (create ↔ delete, geometry before ↔ after). Keyboard: Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y; tool keys V / R / E / P. Shortcuts are ignored while typing in an input.
- **From manga-reader:** port the region union and ellipse-to-points, the attach/detach tool base, and reading-order sorting (threshold relative to image size, for later auto-detect). Rebuild zoom (manga-reader used a CSS scale), undo (additions only), conversion (duplicated, with polygon offset bugs) and persistence (never saved). Skip the brush/inpaint sidecar, the timeout-based reloads and the hand-drawn merge.

### Phase 3 design (2026-09-14, branch `feat/studio-mask`)

**Server: mask layers and partial re-clean**, each call under the per-page lock and refused (409) while the page is queued or running:
- `PUT /studio/api/pages/:id/mask/:layer` (`add` | `erase`) `{ image }` saves a painted layer: a page-size PNG (base64 or data URL), bright pixels = painted. A layer of a different size is refused (422); an empty layer deletes the file, so an untouched page keeps using the detector mask as is. `DELETE …/mask/:layer` clears it. Both mark `clean_text`, `clean_sfx` and `render` stale.
- Effective mask = (detector `mask.png` ∪ add) − erase. The text pass removes painted-in pixels wherever they are, even outside any block, and adds their connected areas as inpaint regions; block ownership (`selectBlockMask`) still decides which detected pixels each pass removes.
- `POST …/reclean` `{ areas: [{x, y, w, h}] }` (1–50 areas inside the page) inpaints the effective mask inside those areas on the latest cleaned image (`clean-sfx.png` when present, else `clean-text.png`), in place. Pixels outside the dilated mask stay byte-identical. Only a part of a clean pass ran, so the clean stages keep their status and only `render` turns stale. Erased pixels can't be restored this way (the original isn't consulted): run Clean text for that.
- `PATCH …/blocks/:idx` also takes `include`. Changing it marks `clean_text`, `clean_sfx` and `render` for a text block, or `clean_sfx` and `render` for a sound effect; sending the current value marks nothing.
- `POST …/run` also runs `clean_text` (makes `clean_sfx` and `render` stale; it deletes `clean-sfx.png`) and `clean_sfx` (makes `render` stale). Cleaning always covers the whole kind. `clean_sfx` is refused (409) while `clean_text` is stale or failed, since it cleans on top of `clean-text.png`.
- A full re-run of the page deletes the painted layers along with the other derived outputs.

**Client:**
- **Brush tool** (B) in `PageCanvas`: Add / Erase (X swaps), size 2–200 page px ([ and ]), a circle cursor. Layers are page-size offscreen canvases (`client/studio/canvas/mask-layers.ts`) shown as Fabric images under the regions: blue detector mask, green painted in, red erased. The overlay shows while the brush is active or via the eye toggle (M). A stroke on one layer clears the other under it, since erase wins on the server.
- **Undo / redo:** each stroke is a command holding the before/after pixels of its bounding box on both layers; only the layers it changed are saved (after each stroke, through the canvas's serial queue).
- **Re-clean** button: the merged boxes of add strokes not re-cleaned yet, or else the selected region's box. It waits for pending saves and refreshes the stage images.
- **Include toggles:** a "clean" checkbox on each text block card and on a new sound-effects list. Excluded regions are drawn dashed and unfilled.
- **Editor actions:** Clean text / Clean SFX buttons (amber while stale). "Detected text mask" is added to the image pickers.

## 11. Adopt from manga-reader / avoid

**Adopt** (`/home/decky/Documents/funs/bun/manga-reader`):
- Fabric studio structure: `StudioCanvas.tsx`, `studioFabricStore.ts`, tool handlers (`components/studio/tools/*`)
- Region model: `src/lib/region-types.ts`
- Style popover: `TextObjectPopover.tsx`; region list with thumbnails: `RegionListPanel.tsx`
- Auto-detect with reading-order sort: `AutoDetectButton.tsx`
- Page thumbnail grid, unsaved-changes guard, chapter ZIP upload + reorder (`UploadChapterPage.tsx`, `ChapterGalleryPage.tsx`)

**Avoid** (known problems there):
- Regions / text not persisted; client-side burn that ignores wrap, rotation and alignment
- Cleaning overwrites the original page (no stage files, no revisions)
- Undo tracks additions only; CSS-only zoom; regions not resizable
- Duplicated region-conversion code; `setTimeout` reload chains; dead Python-sidecar paths (`generatePatch`, `mergePatches`, `CleaningService` mask helpers)

---

## 12. Open questions

- Confirm Fabric.js (D7).
- How many history revisions to keep per page.
- Migrate existing `page_translation_jobs` into `pages`, or drop dev data?
- Licences for Nunito (OFL — fine) and ToonTime (unclear) before bundling extra fonts.
