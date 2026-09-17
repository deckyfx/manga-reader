/** Shared Elysia TypeBox schemas for response validation and Eden Treaty type inference. */
import { t } from "elysia";

export const ErrBody = t.Object({ error: t.String() });

export const JobSchema = t.Object({
  id: t.String(),
  imageHash: t.String(),
  sourcePath: t.String(),
  status: t.String(),
  totalBubbles: t.Integer(),
  processedBubbles: t.Integer(),
  createdAt: t.String(),
  updatedAt: t.String(),
  errorMessage: t.Nullable(t.String()),
  textSegBlocks: t.Nullable(t.String()),
  inpaintEnabled: t.Boolean(),
  bubbleEnabled: t.Boolean(),
});

export const BubbleSchema = t.Object({
  id: t.Integer(),
  jobId: t.String(),
  bubbleIndex: t.Integer(),
  x: t.Number(),
  y: t.Number(),
  width: t.Number(),
  height: t.Number(),
  rotation: t.Number(),
  sourceText: t.Nullable(t.String()),
  translatedText: t.Nullable(t.String()),
  ocrLogId: t.Nullable(t.Integer()),
  translateLogId: t.Nullable(t.Integer()),
  inpaintedImagePath: t.Nullable(t.String()),
  patchImagePath: t.Nullable(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
  styleJson: t.Nullable(t.String()),
});

export const TextSegBlockSchema = t.Object({
  id: t.String(),
  x: t.Number(),
  y: t.Number(),
  w: t.Number(),
  h: t.Number(),
  source_text: t.Nullable(t.String()),
  translated_text: t.Nullable(t.String()),
});

export const VolumeSchema = t.Object({
  id: t.Integer(),
  title: t.String(),
  coverPath: t.Nullable(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
});

export const ChapterSchema = t.Object({
  id: t.Integer(),
  volumeId: t.Integer(),
  title: t.String(),
  sortOrder: t.Integer(),
  pagesDir: t.String(),
  createdAt: t.String(),
  updatedAt: t.String(),
});

export const ModelInfoSchema = t.Object({
  repo: t.String(),
  dir: t.String(),
  enabled: t.Boolean(),
  files: t.Array(t.String()),
  ready: t.Boolean(),
});
