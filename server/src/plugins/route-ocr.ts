import Elysia, { t } from "elysia";
import { bootState } from "@/boot-state";
import { inferenceQueue } from "@/queue/inference-queue";
import { OcrStore } from "@/stores/ocr-store";
import { ScanStore } from "@/stores/scan-store";
import { JobStore } from "@/stores/job-store";
import { ErrBody } from "@/lib/schemas";
import { join } from "path";
import { env } from "@/env";
import { resolveTranslationEngine } from "@/services/translation-engine";
import { PAGE_JOBS_DIR } from "@/stores/page-store";
import { authContext } from "@/plugins/auth/index";

export const routeOcr = new Elysia()
  // For `principal`: the guard in plugins/auth/guard.ts is what enforces the role, this is how the handler sees who
  // ran the scan, so the activity log can say so
  .use(authContext)
  // ── POST /ocr ─────────────────────────────────────────────────────────────
  .post(
    "/ocr",
    async ({ body, principal, status: error }) => {
      if (!bootState.ocrReady)
        return error(503, { error: "OCR model not ready" });

      let imageData = body.image;
      const comma = imageData.indexOf(",");
      if (comma >= 0) imageData = imageData.slice(comma + 1);

      // Pre-decode size check (~10 MB binary ≈ 13.7 MB base64).
      if (imageData.length > 14 * 1024 * 1024)
        return error(400, { error: "image payload exceeds 10 MB limit" });

      // Strict Base64: length%4===1 is structurally impossible; padded input ("=") must be a
      // multiple of 4; characters must be standard alphabet with at most 2 trailing pad chars.
      if (
        imageData.length % 4 === 1 ||
        (imageData.includes("=") && imageData.length % 4 !== 0) ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(imageData)
      )
        return error(400, { error: "image must be valid base64" });

      const imageBytes = Buffer.from(imageData, "base64");
      if (imageBytes.length > 10 * 1024 * 1024)
        return error(400, { error: "decoded image exceeds 10 MB limit" });

      // A client says whether it wants a translation; which engine makes it is the server's business (see
      // Settings → Translation). `translate_engine` is what older clients sent: "none" still means don't, and a
      // named engine now means yes, please — with the engine this server chose.
      const wantsTranslation = body.translate ?? (body.translate_engine?.toLowerCase() ?? "none") !== "none";
      const engine = wantsTranslation ? resolveTranslationEngine() : "none";
      if (engine === "local" && !bootState.translateReady)
        return error(503, { error: "Translate model not ready" });

      const ocrResult = await inferenceQueue.enqueue<
        { imageBuffer: Buffer },
        { text: string; processingTimeMs: number }
      >("ocr", { imageBuffer: imageBytes });

      let translation: string | null = null;
      if (engine !== "none" && ocrResult.text) {
        const tr = await inferenceQueue.enqueue<
          { text: string; engine: string },
          { translatedText: string; processingTimeMs: number }
        >("translate", { text: ocrResult.text, engine });
        translation = tr.translatedText;
      }

      OcrStore.insertOcrLog({
        imageHash: await hashBuffer(imageBytes),
        sourceText: ocrResult.text,
        modelRepo: env.OCR_MODEL_REPO,
        processingTimeMs: ocrResult.processingTimeMs,
      }).catch(() => {});
      // The activity log: who scanned, and what came back. Like the log above, a failure here never fails the scan
      if (principal) {
        ScanStore.insert({
          userId: principal.user.id,
          ...(principal.apiKeyId !== undefined ? { apiKeyId: principal.apiKeyId } : {}),
          username: principal.user.username,
          sourceText: ocrResult.text,
          translatedText: translation,
          translateEngine: engine,
          elapsedMs: ocrResult.processingTimeMs,
        }).catch(() => {});
      }

      return {
        text: ocrResult.text,
        translation,
        elapsed_ms: ocrResult.processingTimeMs,
      };
    },
    {
      body: t.Object({
        image: t.String(),
        /** Whether to translate what was read. Which engine does it is the server's choice. */
        translate: t.Optional(t.Boolean()),
        /** What older clients sent instead; "none" means don't translate, any engine name means do. */
        translate_engine: t.Optional(t.String()),
        track_job: t.Optional(t.Boolean()),
      }),
      response: {
        200: t.Object({
          text: t.String(),
          translation: t.Nullable(t.String()),
          elapsed_ms: t.Integer(),
        }),
        400: ErrBody,
        503: ErrBody,
      },
    },
  )

  // ── GET /jobs/:id/status ──────────────────────────────────────────────────
  .get(
    "/jobs/:id/status",
    async ({ params, status: error }) => {
      const job = await JobStore.findById(params.id);
      if (!job) return error(404, { error: "not found" });
      return { status: job.status, job_id: job.id };
    },
    {
      response: {
        200: t.Object({ status: t.String(), job_id: t.String() }),
        404: ErrBody,
      },
    },
  )

  // ── GET /jobs/:id/result-image ────────────────────────────────────────────
  .get("/jobs/:id/result-image", async ({ params, status: error, set }) => {
    const job = await JobStore.findById(params.id);
    if (!job) return error(404, { error: "not found" });

    const resultPath = join(PAGE_JOBS_DIR, params.id, "result.png");
    const file = Bun.file(resultPath);
    if (!(await file.exists())) return error(404, { error: "result image not found" });

    set.headers["Cache-Control"] = "no-cache";
    return file;
  });

async function hashBuffer(buf: Buffer): Promise<string> {
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(buf);
  return hash.digest("hex");
}
