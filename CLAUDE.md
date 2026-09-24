# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

```
server/      Bun server: OCR, translation, page pipeline, Studio + reader SPA (TypeScript, Elysia, Drizzle, onnxruntime-node)
extension/   Browser extension (MV3, TypeScript + Bun)
desktop/     Avalonia desktop companion (C#, .NET 10); talks to the server's /health, /ocr, /analyze
docs/        PLAN_dashboard_studio.md: the Studio / reader plan with per-phase design notes
tools/       sugoi/: a containerised Sugoi translation server the Bun server can use (SUGOI_URL)
WebOcr.slnx  .NET solution for the desktop app
```

The ASP.NET Core (C#) server was removed; its last version is tagged `csharp-server-final`.

## Common commands

### Server

```bash
cd server
bun install
bun run dev              # bun --hot src/index.ts, listens on :3579 (the user runs the server; don't start it yourself)
bun run typecheck        # tsc --noEmit (covers src/, client/, scripts/)
bun run build            # embed migrations → typecheck → single executable ./app
bun run db:generate      # after changing src/db/schema.ts: drizzle-kit generate + re-embed migrations
bun run page <image>     # run the page pipeline from the CLI (scripts/page.ts)
bun run types:api        # emit API types for the extension's Eden client (server/types/)
```

### Extension

```bash
cd extension
bun install
bun run build        # production (type-check + build, bumps version)
bun run build:dev    # dev build only
bun run typecheck    # regenerates ../server types:api, then tsc --noEmit
```

### Desktop

```bash
cd desktop
dotnet build
dotnet run
```

## Server architecture

**Boot** (`src/index.ts`): run embedded Drizzle migrations, fail page jobs interrupted by the last shutdown and sweep leftover deleted-page folders, download and load models (`bootState` tracks readiness; `/health` reports it), then listen. `env.ts` is the typed config (port, `DATABASE_URL`, model repos/dirs/enabled flags, `DEEPL_API_KEY`, …).

**HTTP** is Elysia, one plugin per area:
- `src/api.ts` + `src/plugins/route-*.ts`: extension and desktop routes (`/health`, `/ocr`, `/translate`, `/analyze`, `/api/translate-page/*` with SSE progress, `/api/settings`). The extension imports these types through Eden Treaty.
- `src/plugins/studio/`: `/studio/api/*`, covering page detail, block edits, mask layers, re-clean, stage runs, text placement, publish, history and fonts.
- `src/plugins/read/`: the `/read/api/*` reader skeleton.
- `src/plugins/route-spa.ts`: the React SPA (`client/`) is served through Bun's `serve.routes` (`/home`, `/studio/*`, `/read/*`, `/settings`); `/` redirects to `/home`.

**Database**: SQLite through Drizzle (`src/db/schema.ts`). Migrations live in `src/db/migrations/` and are embedded into `src/db/migrations-embedded.ts` so the single executable carries them. Stores in `src/stores/` (e.g. `PageStore`: pages, per-stage state, blocks with style / area JSON) are the source of truth; page folders under `data/jobs/<id>/` hold images only.

**Page pipeline** (`src/services/page-pipeline.ts`): detect → OCR → translate → clean text (→ clean SFX) → render (burn). Each stage has a fresh / stale / error state; edits mark later stages stale. Work is serialized through `src/queue/page-queue.ts` (`withPageLock` per page, `runExclusiveResult` for CPU/ONNX work — a label makes the queue log what the work cost).

**What gets cleaned** (`src/services/block-filter.ts`): the detector marks anything letter-like, so blocks are filtered out of cleaning in two passes — geometry at detect (specks, slivers, page numbers in the margin) and, once read, anything that says nothing (`……`, `！？`). Excluded blocks are kept and drawn dashed, never dropped; the Studio can switch them back on. A re-read that changes inclusion marks the clean stages stale.

**Translation** (`src/services/translate-service.ts`, `translation-engine.ts`): one resolver decides the engine (built-in ONNX, DeepL, or a self-hosted Sugoi at `SUGOI_URL`) for every route and the pipeline alike — clients say *whether* to translate, never *how*. A page's blocks go in one request (50 at a time for DeepL, 64 for Sugoi, 1 for the built-in model, which has no round trip to save); a wrong-length answer is an error, since position is all that ties a translation to its block. Transient failures (429, 5xx, a container still loading) are retried with backoff (`src/lib/retry.ts`); a malformed answer is not.

**Resource measurement** (`src/lib/resource-probe.ts`, `src/services/resource-monitor.ts`): each stage is sampled while it runs and logged with what it used (processor, resident memory and what the stage added, GPU where sysfs can report it). `/api/resources/events` streams the same readings to the Studio's display, sampling only while somebody watches.

**Lettering** is shared code: `src/shared/typeset.ts` (browser-safe, opentype.js + hyphen) lays out and draws text for both the server burn and the Studio's live preview, so they match. Text areas are stored unshifted on blocks; style offset / box are applied on top (see `.coderabbit.yaml`).

**Client** (`client/`): React 19 + TanStack Query + Tailwind v4, Fabric.js canvas for the Studio editor (`client/studio/canvas/`).

## Extension architecture

MV3 extension with two OCR engines:
- **Tesseract.js**: runs entirely in-browser via `engine.ts`
- **Remote server**: calls the Bun server's routes through a typed Eden client (`src/api.ts`)

Key files: `background.ts` (service worker), `content.ts` (overlay + selection), `options.ts` (settings page), `types.ts` (shared types).

## Desktop architecture

**State machine**: `MainViewModel` drives the app through `AppStatus` states: `Idle → Capturing → Selecting → Analyzing → Error`.

**Services:** `HotkeyService` (SharpHook global hotkey `Super+Shift+O`), `ScreenCaptureService`, `LocalTesseractService` (on-device fallback), `ServerClient` (typed `HttpClient` for `/ocr`, `/analyze`, `/health`, with `X-Api-Key` when set). Settings (`ServerUrl`, default `http://localhost:3579`, and `ApiKey`) persist through `SettingsStore`.

## Key invariants

- **Never commit `server/.env`**: it holds a real DeepL API key. Stage specific files, never `git add -A`.
- **Drizzle migrations are committed and embedded**: change `src/db/schema.ts`, then `bun run db:generate` (it re-embeds). Never edit or delete existing migration files.
- **`server/data/` is gitignored**: models, the SQLite database, page folders and logs are runtime-only.
- **Don't run the server**: the user runs it. Test in-process with `app.handle()` and a scratch `DATABASE_URL`; never delete anything under `data/` that a test didn't create.
- **A test that pins behaviour should be checked by breaking the behaviour**: remove the fix, watch the test fail, put it back. Twice in one session a test passed for the wrong reason and only this caught it.
- **`desktop/bin/`, `desktop/obj/`, `*/publish/`** are gitignored build output.
