import { series, chapters, pages, userCaptions } from "./schema";
import { spreads } from "./utils";

/**
 * Singleton database model
 * Provides type-safe insert and select schemas for all tables
 *
 * Usage:
 * - Insert schema: dbModel.insert.series
 * - Select schema: dbModel.select.series
 *
 * Access from anywhere: import { dbModel } from "./db/model"
 */
export const dbModel = {
  insert: spreads(
    {
      series,
      chapters,
      pages,
      userCaptions,
    },
    "insert",
  ),
  select: spreads(
    {
      series,
      chapters,
      pages,
      userCaptions,
    },
    "select",
  ),
} as const;
