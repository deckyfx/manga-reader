# Selfhost OCR

![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/deckyfx/web-ocr?utm_source=oss&utm_medium=github&utm_campaign=deckyfx%2Fweb-ocr&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)

> Forked from [brian-girko/image-reader](https://github.com/brian-girko/image-reader) — original OCR Image Reader extension by Brian Girko, licensed under MPL 2.0.

A browser extension (MV3) that lets you select any region on screen and extract text via OCR. Supports two engines: **Tesseract.js** (runs entirely in-browser, no server needed) or a **self-hosted Bun server** with ONNX OCR, translation, whole-page manga translation and a Studio for editing translated pages.

## Features

- Click the toolbar button, drag to select a region — text appears instantly
- **Dual engine**: Tesseract.js (offline, in-browser) or the self-hosted server (faster, optional DeepL translation)
- **Japanese vertical text** support via `jpn_vert` traineddata (reads columns right-to-left)
- Per-word dictionary panel (Jisho or local Jitendex) with romaji and JLPT tags
- Draggable, resizable result panel
- DeepL translation (client-side or server-side)
- **Page translation**: detect text, OCR, translate, clean the lettering and typeset the translation, replacing the image in the open tab
- **Studio** (`/studio`): edit detected regions, paint the text mask, re-clean areas, and move / resize / rotate / restyle the lettering with a live preview that matches the final image
- **Library** (`/manage`): series → volume (optional) → chapter → page, with cover art, tags, ZIP / CBZ import, drag-to-reorder, whole-chapter translation and export
- **Reader** (`/read`): browse by title, tag or status and read a chapter right to left or left to right, resuming where you left off
- Editing a page never changes what readers see until it is published
- **Accounts**: reading is open to everyone; managing the library, the Studio and OCR need an account, with an authenticator app or a passkey on top of the password if you want one
- Manifest V3 — works on Chrome, Edge, and Firefox

## Project Structure

```
server/        Self-hosted server: OCR, translation, page pipeline, Studio (Bun + Elysia + ONNX)
extension/     Browser extension (TypeScript + Bun)
desktop/       Desktop companion app (Avalonia / C#)
docs/          Studio, library and reader plan
WebOcr.slnx    .NET solution for the desktop app
```

## Extension Setup

### Requirements

- [Bun](https://bun.sh) v1.2+
- Chrome / Edge / Firefox (MV3)

### Build

```bash
cd extension
bun install
bun run build        # production — bumps patch version, outputs to dist/
bun run build:dev    # dev — skips version bump / archive
```

Load the extension in Chrome: `chrome://extensions` → **Load unpacked** → select `extension/dist/`

### Tesseract Engine (default)

No server needed. Language data is downloaded on first use from `tessdata.projectnaptha.com`.

Supported languages include Japanese (`jpn`), Japanese vertical (`jpn_vert`), English (`eng`), Chinese Simplified/Traditional, Korean, and more — selectable in the settings page.

### Self-hosted Server Engine

Requires the Bun server running locally. On first run it downloads the ONNX models it needs (OCR, translation, text detection, inpainting, bubble detection) and the Jitendex dictionary.

```bash
cd server
bun install
bun run dev
```

Default address: `http://localhost:3579` — reader at `/read`, library management at `/manage`, Studio at `/studio`, your account at `/user`, server settings at `/admin`.
Put settings such as `DEEPL_API_KEY` in `server/.env`.

**First run**: open the server in a browser and it asks for one admin account at `/setup`; that page closes itself as soon as an account exists. Reading stays open to anyone. Everything else — the library, the Studio, OCR, translation, the dictionary — needs an account, and an admin decides from `/admin` whether other people may register themselves.

The server binds to `127.0.0.1` by default. Set `HOST=0.0.0.0` to reach it from other devices. Plain http is fine for development, but it sends passwords and session cookies across the network in clear, so put TLS in front of any real deployment (and set `TRUST_PROXY`). Passkeys only work on `localhost` or over https.

`data/secret.key` appears on first start and encrypts the authenticator secrets. Back it up with the database: without it, enrolled authenticator apps stop working and have to be set up again.

### Connecting the extension

1. In the server's UI, open `/user` → **API keys** and create one. It is shown once.
2. In extension settings, choose the **Remote Server** tab, enter the server URL and paste the key.
3. Click **Test Connection** — it reports whether the server is up *and* whether the key was accepted, naming the account it belongs to. Then save.

For a plain-`http` address that isn't on this machine (a LAN server, say), the extension withholds the key, and Test Connection refuses, until you tick **Send the key over plain http anyway**: anyone on that network could read the key.

Without a key the server refuses OCR, translation and page jobs. The desktop app takes the same key in its settings.

To build a single executable: `bun run build` (outputs `server/app`).

## Server Features

- ONNX OCR (Manga-OCR) and local Japanese→English translation (Opus-MT), with optional DeepL
- Jitendex dictionary lookups with Kuromoji tokenization (`/analyze`)
- Page pipeline: comic text detection, block OCR and translation, LaMa inpainting to clean lettering, bubble-aware typesetting
- Studio for correcting and re-lettering pages, with per-stage state, partial re-runs, publish history and rollback
- Library of series, volumes, chapters and pages: import, reorder, batch translate, export, and a reader that is served published pages only
- Accounts with roles (admin, contributor, reader), authenticator apps and passkeys as second factors, and API keys for the extension and the desktop app
- SQLite (Drizzle) with migrations embedded in the build
- `/health` reports readiness while models load

## Desktop App

The Avalonia desktop companion runs in the system tray and provides a global hotkey (`Super+Shift+O`) to capture a screen region and analyze it without a browser.

```bash
cd desktop
dotnet run
```

The app sends captured regions to the running server at `http://localhost:3579` (configurable in settings).

## Version

The extension version lives in `extension/package.json` and `extension/static/manifest.json`. Every `bun run build` automatically bumps the patch number and keeps both files in sync.
