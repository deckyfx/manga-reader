# Plan: providers, workspaces, add-by-URL, scan log, settings layout

Written 2026-09-18 on top of `feat/auth`, pivoted 2026-09-19. It covers the next batch of ideas, one PR per phase, using
the same branch → PR → CodeRabbit loop as `PLAN_dashboard_studio.md`.

**The main goal (2026-09-19):** a contributor opens a chapter in their browser and imports **the whole chapter** into
the Studio **as a workspace** in one step, then works through it there. Today each page is scanned one at a time from
the extension. Downloading happens **in the extension**, because the user's browser is already signed in and past
Cloudflare. The server doesn't scrape, doesn't hold site accounts and doesn't need a headless browser.

## 0. What exists today (the starting point)

| Area | Today | Gap |
|---|---|---|
| Add by URL | `POST /studio/api/pages {url}` takes one image URL through `fetchImage` (SSRF-guarded, DNS-pinned). The New page dialog has an "Image URL" tab. | Chapters (`POST /manage/api/chapters/:id/pages`) only accept files/ZIP. No multi-URL. |
| Chapter → Studio | Chapter pages are already `pages` rows (`chapterId` set) and list under the Studio's "In chapters" scope. Readers see only published snapshots. | No way to treat a chapter as one unit in the Studio; the list is flat. |
| Studio list | Flat list of pages, scope inbox / chapter / all. | Clutters as soon as a chapter or bulk import lands. |
| Region scan | `POST /ocr` writes `ocr_logs {image_hash, source_text, model_repo, ms}`. | No user, key, page URL, translation, engine or thumbnail, and nothing reads it. |
| Settings UI | `/user` (5 stacked sections, 516 lines), `/admin` "Server" (3 stacked sections), `/settings` (stacked sections). | Long scrolls, narrow column. |
| Chapter import | The extension translates one page at a time (`/api/translate-page`). It already has `<all_urls>` host permission, and a contributor API key may call `/studio/api` and `/manage/api` (`auth/guard.ts`). | No way to take a whole chapter; server-side fetching fights logins and Cloudflare (probe 2026-09-18: forums.e-hentai.org login gets a 403 challenge). |

## 1. Phases (suggested order: the main goal first)

| # | Phase | Size | State |
|---|---|---|---|
| P3 | Workspaces (+ Send chapter to Studio, File into chapter) | M | **Done** — PR #25 |
| P4 | **Extension: import a chapter as a workspace** (generic extractor + rawkuma) | M–L | In progress, branch `feat/extension-chapter-import` |
| P5 | exhentai extractor + adult flag | S–M | Next after P4, same session |
| P0 | Settings areas: sub-menus, full width | S | **Done** — PR #26 |
| P1 | Add pages by URL (Studio and chapter, many at once) | S | After P4, same session |
| P2 | Region scan log | S–M | **Done** — PR #26 |
| P6a | Publish backfill | S | This PR |
| P6b | Several cover arts | M | Next |
| P6c | Reviews and ratings | M | After covers |

Two sessions are working through this in parallel: one on P4 → P1 → P5 (the extension side), one on P6 (the library
side). Migrations are not reserved ahead — generate at push time, and whoever merges second rebases and re-runs
`bun run db:generate`.

P0–P2 can be picked up whenever. They don't block P3 and P4, and P3 and P4 don't block them.

## 2. P0: settings areas as sub-menus

All three pages become **sectioned pages**: a left sub-menu (a top tab strip on narrow screens) and a full-width content
pane. Each section gets its own URL, so it can be linked, refreshed, and back/forward works.

```
/user/:section      profile · security (password + authenticator + recovery) · passkeys · api-keys · sessions · scans (P2)
/admin/:section     policy · users · sessions · scans (P2)
/settings/:section  engines/models · translation · pipeline defaults · … (grouped from the current sections)
```

- One shared `SectionedPage` component (`client/components/SectionedPage.tsx`): `sections: {id, label, icon, render, visible?}[]`.
  `/user` redirects to its first visible section.
- Split `UserPage.tsx` into `client/pages/user/*Section.tsx` (it is already split into functions; this is a move). Do the
  same for `AdminPage.tsx`.
- Drop the `max-w-*` wrapper on these pages. Content fills the pane, and the Users and Sessions tables get room for more
  columns.
- Routes in `App.tsx`: `user/:section?`, `admin/:section?`, `settings/:section?`. `route-spa.ts` already serves
  `/admin/*` but not `/user/*` or `/settings/*`, so add those two patterns.

## 3. P1: add pages by URL

- **Studio** New page dialog: the URL tab takes a textarea, one URL per line (max ~50). Each line becomes its own
  `POST /studio/api/pages {url}`, so the endpoint stays unchanged. With more than one URL the pages can go into a new
  workspace (P3); until then they go to the Inbox.
- **Chapter**: `POST /manage/api/chapters/:id/pages/urls {urls: string[]}`. It downloads through `fetchImage` one at a
  time (polite, bounded), then feeds the bytes into `importIntoChapter` as `ImportSource {name: <url basename>, bytes}`.
  It returns the same report shape as the file import (`imported`, `skipped[] {name, reason}`).
- The "Add pages" panel on `ManageChapterPage` gets a "From URLs" tab next to the file upload.
- `pages.source` records the URL (already a free-text field).
- Limits: reuse `MAX_IMAGE_BYTES` and `MAX_PAGES_PER_IMPORT`. Per-URL errors are skipped entries, not a failed request.
- Tests: in-process with `app.handle()` and a local `Bun.serve` image host. That needs the resolver injection
  `fetchImage` already has, because localhost is blocked on purpose.

## 4. P2: region scan log

**Decision (2026-09-18):** an activity log of who scanned and what came out. No page address and no crop images.

New table, rather than widening `ocr_logs` (that one is a hash-keyed record of OCR results; mixing in per-request
activity would blur it):

```ts
regionScans: id, userId (fk users, set null), apiKeyId (fk api_keys, set null),
             translateEngine, sourceText, translatedText (nullable), elapsedMs, createdAt (indexed)
```

- `POST /ocr` writes one row per request, using the principal the auth guard already resolves (user and key). The
  request body stays the same, so the extension doesn't change.
- Only scans that reach the server are logged. Tesseract.js scans in the browser never do.
- Retention: server setting `scan_log_days` (default 30), swept at boot and then daily.
- API: `GET /manage/api/scans?user=&q=&before=`, paged by `createdAt,id`. Admins see everyone's scans; everyone else
  sees only their own.
- UI: `/admin/scans` for everyone's scans and `/user/scans` for your own. It's a table with the time (WIB), user, key
  name, text → translation, engine and ms, plus user and text filters.

## 5. P3: workspaces + send chapter to Studio

**Status (2026-09-20): done** — schema + store, `/studio/api/workspaces` (CRUD, batched uploads, run, file, publish),
`POST /manage/api/chapters/:id/to-studio`, the Studio list / workspace page / editor navigation, and a `bun test` suite.

A **workspace** is a folder of Studio pages. A page can sit loose (as it does now) or in exactly one workspace.

```ts
workspaces: id, name, chapterId (nullable, fk chapters, set null), createdBy (fk users),
            sourceUrl (nullable, indexed), sourceProvider (nullable), adult (bool, default false), createdAt, updatedAt
pages.workspaceId:  nullable fk workspaces, on delete set null  // pages fall back to loose; deleting a workspace never deletes pages
pages.originPageId: nullable fk pages, on delete set null       // the chapter page this draft copies and replaces on publish
```

- **Studio list** becomes: workspaces first (cards with name, page count, done/stale/error counts, first-page thumb), then
  loose pages. `/studio/w/:id` shows one workspace's pages with the same grid, filters, bulk actions and "Run all" (a
  generalised `chapter-batch` that takes a list of page ids).
- The editor gets prev/next inside the workspace (by `sortOrder`) and a "Back to workspace" link.
- Multi-page imports (P1 multi-URL, uploads with several files) offer "put these in a new workspace", defaulting on
  when there is more than one page. Extension chapter imports (P4) always create or extend a workspace.
- Routes (`/studio/api`, contributor, API key allowed):
  - `GET /workspaces`, `POST /workspaces {name, source_url?, source_provider?, adult?}`, `GET /workspaces/:id`,
    `PATCH /workspaces/:id` (rename), `DELETE /workspaces/:id`.
  - `GET /workspaces?source_url=` finds an earlier import of the same chapter, so the extension can offer "add to it or
    start fresh".
  - `POST /workspaces/:id/pages` (multipart `files[]` + `start_index`) appends pages in order. It reuses
    `importIntoChapter`'s normalising (`normalisePage`, `original.png`, idle pages) with a workspace target instead of a
    chapter. The extension uploads in batches through it, and `start_index` makes a retried batch idempotent: an index
    that already has a page is skipped.
    **Limitation (2026-09-20):** the position is the whole idempotency key — a batch resent with *different* content
    for a position that already holds a page is skipped and reported as `existing`, not stored. That suits a retry of
    the same chapter; if P4 ever resends a position with new content, the upload needs a per-page key (the image hash,
    or an id from the extractor) and a conflict when it doesn't match.
  - `POST /workspaces/:id/run` runs the pipeline over the pages that need it ("Run all"); `GET /workspaces/:id/run`
    reports progress, or how many pages a run would take now.
  - **Decision (2026-09-20):** progress is polled, not SSE (the plan first said SSE). Progress only moves once per
    page, so a stream would idle between pages; the chapter run already polls, so the Studio keeps one pattern; and
    the extension (P4) can poll with its `X-Api-Key` header, instead of a stream token in the URL — the thing the
    PR #24 review flagged and that is on the backlog.

### File a workspace into the library

A workspace that came from an import (not from a chapter) holds loose drafts. **File into chapter** picks a series
(existing, or a new one prefilled from the import's title, and its `adult` flag) and a chapter (existing or new, with
the number the extractor found). It then moves the pages in workspace order (`PageStore.filePage`) and publishes the
ones that are translated, as filing does today. After that, the workspace is bound to that chapter (`chapterId`), so
later edits follow the draft-copy rules below.

### Send chapter to Studio: draft copies, published back

**Decision (2026-09-18):** the Studio works on **copies**. The chapter keeps serving its original pages until a copy is
published, and then that copy's result replaces the chapter page.

1. **Send** (Manage chapter page, contributor+) creates a workspace with `chapterId = chapter`. For each chapter page it
   makes a loose draft copy (`pages.chapterId = null`, `workspaceId`, `originPageId = chapter page`). This reuses
   `copyPageIntoChapter`'s copy logic with the target switched to "draft", under the source's page lock. It optionally
   starts "Run all" on the copies.
2. Sending again reuses the chapter's open workspace and only copies pages that have no draft yet, so work in progress
   is never overwritten. Pages of the workspace that were filed into the chapter need no draft: they are already being
   worked on there.
   **Built (2026-09-20):** `pages.origin_page_id` is a foreign key with `ON DELETE SET NULL`, so a draft whose chapter
   page is deleted loses the link and becomes an ordinary loose draft: it publishes itself and can be filed as a new
   page, with no "orphaned" badge. An explicit orphan state would mean keeping the id without the foreign key (a
   tombstone) and a migration; not worth it while the outcome — the draft survives and can be filed — is the same.
   `publishDraft` still refuses when the origin has gone, for the window before the column is cleared.
3. **Publish a draft** that has an `originPageId`: under both page locks, copy the draft's state (stage rows, blocks,
   masks, stage images) over the origin page, then run `publishPage(origin)`. The origin keeps its own publish history,
   so the chapter can be rolled back to the version before. The draft stays in the workspace for further edits and can
   be published again. Its "published" badge compares its revision against the origin's last publish.
4. A workspace-level **Publish all** publishes every draft that has unpublished changes, one page at a time with
   progress.
5. **Close workspace**: deletes the drafts and the workspace, after asking if any draft is unpublished (styled
   `useConfirm`). The chapter isn't touched.
6. Pages added to the chapter later don't join the workspace on their own. "Send again" (step 2) picks them up.

## 6. P4: the extension imports a chapter as a workspace

**Decisions:**
- 2026-09-18: providers are pluggable.
- 2026-09-19: the **extension** does the extraction and the downloading, and the server only receives images. That
  replaces the earlier server-side fetch design, the per-user site accounts and the Cloudflare solver.

### 6.1 User flow

1. The user is on a chapter (or gallery) page and clicks the toolbar popup → **Import chapter**. A context-menu entry
   does the same.
2. The extension works out which extractor fits the URL (§6.3) and collects the ordered page image addresses. The popup
   shows **"Found 25 pages · rawkuma · Chapter 14"**, a thumbnail strip, and a way to untick stray images.
3. Destination:
   - **New workspace** (default), named from the page title and chapter number.
   - **Add to the earlier import** of the same URL, if one exists.
   - Options: **Translate after import** (default on) and **Open in Studio when done**.
4. The download and upload run in the background worker, so closing the popup doesn't stop them. Progress shows on the
   extension badge (`12/25`) and in the popup; a failed page can be retried, and so can the whole import.
5. When done: a notification ("25 pages imported to *Chapter 14*"), and the Studio workspace opens if chosen. If
   Translate after import is on, "Run all" has already started, and pages turn done as they finish.

### 6.2 Where things run

| Step | Runs in | Why |
|---|---|---|
| Collect addresses from the open page | content script (live DOM) | Sees lazy-load attributes, inline scripts and anything the page's JS built |
| Fetch other pages of the chapter (exhentai image pages, paginated readers) | content script, same-origin `fetch` + `DOMParser` | Same origin as the site, so the user's cookies go along and CORS doesn't apply |
| Download images | background worker `fetch` (host permission covers CORS) | CDNs are cross-origin; the worker isn't bound by the page's CSP |
| Upload to the server | background worker, typed Eden client (`extension/src/api.ts`) | Existing API key + server URL; the same "don't send the key over plain http" and "no redirects" rules apply |

- **Referer — settled for rawkuma (2026-09-20):** its CDN (`kuma.kyut.dev`) doesn't check it. Tested by the other
  session against a real chapter image: no Referer, no user agent, a wrong Referer and the right one all returned the
  same 200 and the same 318,148 bytes. So the downloader sends no spoofed headers and needs **no**
  `declarativeNetRequest` permission; a plain worker `fetch` under the existing `<all_urls>` grant is enough. Add the
  rule only when a provider turns out to need it, and re-test for exhentai's H@H nodes (P5), which are a different
  animal.
  If one ever does: `fetch()` can't set `Referer` (a forbidden header name — silently dropped), so the only MV3 route
  is a `declarativeNetRequest` session rule with `modifyHeaders`, using `declarativeNetRequestWithHostAccess` (the
  narrower permission, since `<all_urls>` is already granted). **Still unconfirmed:** whether such a rule matches the
  extension's *own* fetches rather than only page-initiated ones — isolate that with one rule and one fetch before
  building on it.
- **Worker lifetime:** MV3 workers sleep when idle. The import is a queue persisted in `chrome.storage.session`
  (chapter, address list, per-page status, workspace id), so a woken worker resumes where it stopped. A long gallery
  runs in an **offscreen document** if the spike shows the worker gets cut off mid-download.
- **Pacing:** images download 2 at a time, with the extractor's `minIntervalMs` between requests, which matters for
  exhentai's image quota. Batches of about 5 pages are uploaded as they arrive, so the server sees progress early and
  the extension doesn't hold the whole chapter in memory.

### 6.3 Extractors (pluggable)

Extractors live in **`server/src/shared/providers/`**, which is browser-safe, like `shared/typeset.ts`. The extension
bundles them, and the server can import them later if it ever needs to.

```ts
/** The pieces an extractor may use; the extension supplies them (live DOM, same-origin fetch). */
interface ExtractContext {
  url: URL;
  document: Document;                              // the open page
  fetchDocument(url: string): Promise<Document>;   // same-origin fetch + DOMParser, with the user's cookies
  log(message: string): void;
}

interface ChapterExtract {
  images: string[];               // absolute URLs, reading order
  title?: string;                 // series or gallery title
  chapter?: string;               // "14", "14.5"
  adult?: boolean;
}

interface Extractor {
  id: string;                     // "rawkuma", "exhentai", "generic"
  label: string;
  matches(url: URL): boolean;     // "generic" matches everything and is tried last
  minIntervalMs: number;
  extract(ctx: ExtractContext): Promise<ChapterExtract>;
}
```

- `registry.ts` is a static list of extractors. Adding a site means one file plus one line in the list.
- **`generic`** handles unknown sites:
  - It collects `img` `src`, `data-src`, `data-lazy-src`, `data-original` and `srcset`, plus `<noscript>` fallbacks.
  - It keeps the largest group that shares a host and path prefix, and drops tiny images (by `width`/`height`
    attributes or natural size), logos and avatars.
  - Its title comes from `og:title`.
  - The popup's untick list is the safety net when it guesses wrong.
- **Scroll fallback:** if an extractor finds fewer images than the page seems to hold, or the user presses "Scan
  again", the content script scrolls the page to the bottom in steps. A `MutationObserver` collects new image addresses
  until the count stops growing, and then the page's scroll position is restored. It's the last resort, for readers
  that build their image list in JS as you scroll.
- Tests: each extractor runs against saved fixture HTML under `bun test` (a DOM is needed there: `happy-dom` as a dev
  dependency, or `linkedom`), so a site redesign shows up as a failing fixture.

### 6.4 rawkuma.net

- `matches`: `rawkuma.net/manga/<slug>/chapter-<n>.<id>/`.
- The images are plain `<img>` tags in the reader, served from `kuma.kyut.dev`, and all of them are in the HTML: the
  2026-09-18 probe found 25 with no JavaScript run, and they downloaded with only a `Referer`.
- The title comes from the breadcrumb or `og:title`, and the chapter from the URL.
- Keep this a thin wrapper over `generic` with a fixed selector, so a layout change breaks loudly instead of picking the
  wrong images.

### 6.5 Server side (small)

- Everything goes through the P3 workspace routes: create/find a workspace, append pages, run.
- An import records `sourceUrl` and `sourceProvider` on the workspace, and `pages.source` gets the image URL, so a later
  import of the same chapter can be spotted.
- Limits: `MAX_IMAGE_BYTES` per page and `MAX_PAGES_PER_IMPORT` per workspace; anything outside them is reported per
  page.
- `/api/settings` (which the extension already reads) gains a `workspaces: true` capability flag, so an older server
  makes the popup say "update the server" instead of failing halfway.

### 6.6 Series info

On a series page, the popup offers **New series from this page**. It sends `og:title`, `og:description` and the
`og:image` cover (downloaded by the extension, as for chapter images) to the existing `/manage/api` series routes, and
opens the new series in the web UI to review.

## 7. P5: exhentai extractor (in the extension)

- No stored credentials: the user is signed in to exhentai in their browser, so the content script's same-origin
  fetches carry their cookies. If the page is the "sad panda" (no access), the popup says so.
- `matches`: `exhentai.org/g/<gid>/<token>/` and `e-hentai.org/g/…` (same markup).
- `extract`:
  1. Read the page count from the gallery's pager. For each gallery page `?p=0..N`, `fetchDocument` it and collect the
     `/s/<key>/<gid>-<n>` links in order.
  2. For each link, `fetchDocument` the image page and read `#img[src]`. The images come from H@H nodes on arbitrary
     hosts, which `<all_urls>` covers.
  3. That's 1 + pages/40 + page-count requests at `minIntervalMs` ≥ 1000. The popup shows "reading page 37/120" while
     collecting.
  4. The title comes from `#gn` (or `#gj` for the Japanese title), with `adult: true`.
- **Quota:** a 509 image ("bandwidth exceeded") or an error page stops the import with "image limit reached". Pages
  already imported stay, and a retry later continues from the next page.

### Adult flag (lands with P5)

- `series.adult` boolean (default false). It's editable in the series form, and pre-set from `workspaces.adult` when a
  workspace imported by an adult extractor is filed into a new series.
- `users.showAdult` boolean (default false), toggled under `/user/profile`. Guests never see adult series.
- The filter applies server-side in every `/read/api` list, search and series/chapter/page fetch. A hidden series
  returns 404, not 403, so its existence doesn't leak. Contributors still see everything in `/manage` and the Studio.

## 8. P6: library backlog

- **Several cover arts**: `series_covers {id, seriesId, path, label, sortOrder, createdAt}`. The default is the latest
  unless one is pinned (`series.coverId`, nullable). Migrate the existing `coverPath` into the table.
- **Reviews and ratings**: `series_reviews` / `chapter_reviews {userId, targetId, rating 1–5, body?, createdAt,
  updatedAt}`, unique on (user, target). An average and count are shown on the series page. Any signed-in user can
  review; admins can remove reviews.
- **Publish backfill** (done): finds chapter pages with a burn but no published snapshot and publishes them, so the
  reader's fallback to `result.png` could be deleted. It runs **both** at boot and from `/admin/maintenance` — the boot
  pass is what makes deleting the fallback safe in the same change, since a library whose admin hadn't pressed the
  button would otherwise serve originals in place of finished pages. It changes nothing a reader can see: it publishes
  exactly the image the fallback was already serving.
  The snapshot keeps the burn's own modification time rather than "now". Whether a Studio draft still has work to
  publish is decided by comparing its render against its chapter page's newest snapshot, so dating an old burn "now"
  would silently stop offering a draft's edits (found in review by the session building P4, before it shipped).

## 9. Cross-cutting

- Schema changes go through `bun run db:generate`, one migration per phase.
- Every new route sits behind the existing role guard: contributor (session or API key) for workspaces, imports and
  URLs; admin for everyone's scan log. No new `sessionOnly` exceptions are needed.
- New files stay under ~1000 lines (the backlog rule). Extractors are one file each.
- Tests run in-process with a scratch `DATABASE_URL`. Extractors are tested against saved fixture HTML. Live sites and
  real accounts are a manual check only.
- Extension changes run `bun run typecheck` in `extension/`, which regenerates the server API types first.

## 10. Decisions and remaining questions

Decided 2026-09-18:
1. **Send chapter to Studio** works on draft copies. Publishing a draft replaces its chapter page, which keeps its
   original until then (§5).
2. **Scan log** is an activity log only: who scanned, and the text and translation. No page address, no crop images (§4).
3. **Providers are pluggable** (§6.3).
4. **Adult flag** and reader filter: yes, landing with P5 (§7).

Decided 2026-09-19:

5. **The extension imports chapters**; the server only receives images. That drops the server-side fetch/cookie design,
   the per-user site accounts, `PROVIDER_SECRET` and the Cloudflare solver (Obscura / Lightpanda / FlareSolverr): the
   user's browser is already signed in and already cleared by Cloudflare.
6. **The goal is chapter → Studio workspace in one step**. Filing into the library is a later, separate action (§5).

To settle in the P4 spike (on rawkuma first):
- Does Chrome send the site's cookies on the worker's cross-site image fetches? It only matters for CDNs that need
  them; rawkuma's don't.
- Does the `declarativeNetRequest` Referer rule apply to the extension's own fetches? Still open, but no longer
  blocking: rawkuma needs no Referer at all (see §6.2), so P4 is built without the rule. The question returns with
  exhentai in P5.
- Does the worker survive a 100-page import, or does it need the offscreen document?
