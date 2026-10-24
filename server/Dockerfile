# The server as a container: the same single executable `bun run build` makes, on a slim Debian with nothing else.
#
#   docker compose up -d --build        from the repository root (compose.yaml), which is the intended way in
#   docker build -t manga-reader server  just the image
#
# The executable carries its code, client and fonts; its lib/ carries the shared libraries onnxruntime and sharp
# open. Models are downloaded on first start into /app/data, which is a volume — so they are fetched once, not on
# every rebuild. Built for linux/amd64: the build only knows where those libraries live on x64 (see NATIVE_LIBS in
# build.ts).

ARG BUN_VERSION=1.4.4

FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /src
# The lockfile first, so a change to the code doesn't throw away the installed packages' layer
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# Embeds the migrations, type-checks, then compiles to dist/app with its libraries in dist/lib
RUN bun run build

# Trixie, like the Bun image the executable was built on, so the two agree about glibc
FROM debian:trixie-slim
# ca-certificates for the model downloads (Hugging Face) and the remote translators; curl for the health check
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# Not root. 1000 is the usual first user on a Linux desktop, so a bind-mounted data folder stays theirs
RUN useradd --uid 1000 --user-group --no-create-home --home-dir /app app

# The working directory is where the server's relative paths start: DATA_DIR defaults to ./data, so an existing
# .env written for a run from source (DATABASE_URL=./data/ocr.db, ./data/models/…) means the same thing in here
WORKDIR /app
COPY --from=build /src/dist/app ./app
COPY --from=build /src/dist/lib ./lib
RUN mkdir data && chown app:app data
USER app

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3579
EXPOSE 3579
VOLUME ["/app/data"]

# The server listens once its models are loaded, and a first start downloads them (a few GB with everything
# enabled) — hence the long grace period. Answering is not enough: a model that failed to load leaves the server
# listening with "starting" for ever, so only "ready" (or "degraded", which is the dictionary alone) counts.
# /health answers anyone, so the check needs no key.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20m --start-interval=10s \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" | grep -Eq '"status":"(ready|degraded)"' || exit 1

ENTRYPOINT ["/app/app"]
