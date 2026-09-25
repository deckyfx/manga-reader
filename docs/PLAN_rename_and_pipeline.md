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

Built, and not quite as planned — recorded here as it stands rather than as it was imagined.

One workflow per part that can break on its own: `server.yml`, `extension.yml`, `desktop.yml`. The desktop's is
separate on purpose. That companion is half-finished and expected to fail; kept apart, a red mark against it says
the desktop is broken without also suggesting the server is, which is the only way a red mark stays worth reading.

**Checks run on every change** to the part they belong to — typecheck and tests for the server, typecheck and a
build for the extension (which also watches the server's routes, since its types are generated from them), a build
for the desktop.

**Artefacts are built on a tag**, one per part: `server-v1.2.3`, `extension-v1.2.3`, `desktop-v1.2.3`. A release is
then something somebody named, rather than whatever main happened to hold that afternoon, and the three can move at
their own speeds. Releases are created and uploaded with the GitHub CLI, already on the runner, rather than a
third-party action.

For the extension the tag *is* the version: `extension-v1.2.3` builds 1.2.3 and writes it into the manifest, so
what the store receives says what the tag says. That needed two flags on a build which until then bumped the patch
number every time it ran, even for a check.

**The server's release refuses to publish anything** until an unpacked copy of the archive answers `--doctor` for
itself, somewhere else on the disk. That check exists because four separate faults in the first compiled binary —
sharp's ESM binding, pino's transports, the shared libraries, a metadata polyfill — were invisible to every test
and appeared only when somebody ran the thing. The doctor already exits non-zero when something would stop the
server; this is what that was for. Missing models are warnings, so a clean runner passes.

**Linux only, still.** macOS and Windows artefacts need entries in `NATIVE_LIBS` and the matching `.dylib` / `.dll`
names in `src/lib/native-libs.ts`, neither of which can be verified from here. The build says plainly when a
target's native parts are missing rather than shipping something that looks finished.

Actions are pinned to commit SHAs with their tags beside them, the workflows are read-only except where a release
asks otherwise, and checkouts don't leave their credentials behind for later steps to find.
