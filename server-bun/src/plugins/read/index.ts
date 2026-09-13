/**
 * Reader API: volumes, chapters and pages for reading (`/read`). Only the skeleton exists so far; book
 * management and the reader arrive in phase 5 of docs/PLAN_dashboard_studio.md.
 */
import Elysia, { t } from "elysia";
import { VolumeStore } from "@/stores/volume-store";

const VolumeSchema = t.Object({
  id: t.Integer(),
  title: t.String(),
  cover_path: t.Nullable(t.String()),
  created_at: t.String(),
  updated_at: t.String(),
});

export const readPlugin = new Elysia({ prefix: "/read/api" })
  .get(
    "/volumes",
    async () =>
      (await VolumeStore.list()).map((v) => ({
        id: v.id,
        title: v.title,
        cover_path: v.coverPath,
        created_at: v.createdAt,
        updated_at: v.updatedAt,
      })),
    { response: { 200: t.Array(VolumeSchema) } },
  );
