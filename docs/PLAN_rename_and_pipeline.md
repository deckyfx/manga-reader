# The name, and a pipeline

Two pieces of work planned together on 2026-09-24, after the repository moved to `deckyfx/manga-reader` and the
server grew a real executable. This file records what was decided and why, including the parts deliberately left
alone — a rename is exactly the kind of change where "why didn't they do this one too?" comes up later.

## The name

Everything a person reads now says **Manga Reader**, and everything a machine reads says `manga-reader`:

| | |
|---|---|
| server | CLI banner, `--version`, the `.env` header, the doctor's heading, the listening line |
| identity | `WEBAUTHN_RP_NAME`, the TOTP issuer, both outgoing `User-Agent`s, the migrations scratch folder |
| client | the page title and the name in the header and sign-in shell |
| extension | manifest name and toolbar title, options page, popup, console prefixes, `manga-reader-chrome.zip` |
| packages | `manga-reader-server`, `manga-reader-chrome`, `manga-reader.code-workspace` |
| build | `dist/manga-reader-<target>.tar.gz` |

**The postMessage contract changed too**: `web-ocr:image-updated` → `manga-reader:image-updated`. The Studio page
emits it and the extension listens for it, and both ship from this repository, so they move together — but an
extension installed before this change stops noticing republished pages until it is reloaded. That was the choice:
a clean name now rather than a compatibility shim carried for ever, for an extension with two users.

### Left alone, on purpose

- **`data/ocr.db`** — renaming it would make every existing install rename a file by hand, or make the server carry
  a fallback for ever. The database is not the product's name.
- **Environment variables** — `DATA_DIR`, `OCR_ENGINE` and the rest were never prefixed, so there is nothing to
  rename and nobody's `.env` breaks.
- **Log file names** — `server.<date>.log` already says what it is.
- **The checkout directory** — somebody's shell, editor and running processes point at it; that is theirs to do.

### The desktop app, after all

Deferred at first as churn on a parked component, then done in the same pass on request: `MangaReader.slnx`,
`MangaReaderDesktop.csproj`, every namespace, `x:Class` and XAML `using:`, the single-instance mutex, the assembly
identity in the manifest, and the launch configuration. It builds with no warnings.

One of those is not only a name: the desktop keeps downloaded Tesseract language data in an application-data
folder that was called `WebOcr` and is now `MangaReader`. An existing install will not find its old copy and will
fetch the data again — a few megabytes, once.

### Harmless by inspection

The **TOTP issuer** is a label baked into the QR when somebody enrols, so apps already enrolled keep showing the
old name and nothing stops working. **`WEBAUTHN_RP_NAME`** is likewise display only: a passkey's validity rests on
the RP *ID*, which is the domain and did not change.

## The pipeline

Not built yet; this is the shape agreed.

**`ci.yml`** on push and pull request: `bun install` with the install cache keyed on `bun.lock`, then the server's
typecheck and tests and the extension's typecheck and build. The tests redirect `DATA_DIR` to a scratch folder, so
nothing downloads a model and a run stays short.

**`release.yml`** on a `v*` tag: `bun run build --archive`, then **unpack the artefact and run `./app --doctor`,
requiring exit 0**, before attaching it to the release. That check exists because four separate failures in the
first compiled binary — sharp's ESM binding, pino's transports, the shared libraries, a metadata polyfill — were
invisible to every test and only appeared when somebody ran the thing. The doctor already exits non-zero when
something would stop the server; this is what that was for. Missing models are warnings, so a clean runner passes.

**Linux only at first.** macOS and Windows artefacts need entries in `NATIVE_LIBS` and the matching `.dylib` /
`.dll` names in `src/lib/native-libs.ts`, neither of which can be verified from here. The build already says
plainly when a target's native parts are missing rather than shipping something that looks finished.
