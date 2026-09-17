import { db } from "@/db/index";
import { ocrLogs, translateLogs, type NewOcrLog, type OcrLog, type NewTranslateLog, type TranslateLog } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export class OcrStore {
  static async insertOcrLog(log: NewOcrLog): Promise<OcrLog> {
    const [row] = await db.insert(ocrLogs).values(log).returning();
    return row;
  }

  static async findOcrLogByHash(imageHash: string): Promise<OcrLog | undefined> {
    return db.query.ocrLogs.findFirst({ where: eq(ocrLogs.imageHash, imageHash) });
  }

  static async listOcrLogs(limit = 100): Promise<OcrLog[]> {
    return db.select().from(ocrLogs).orderBy(desc(ocrLogs.createdAt)).limit(limit);
  }

  static async insertTranslateLog(log: NewTranslateLog): Promise<TranslateLog> {
    const [row] = await db.insert(translateLogs).values(log).returning();
    return row;
  }

  static async findTranslateLog(sourceText: string, targetLang = "en"): Promise<TranslateLog | undefined> {
    return db.query.translateLogs.findFirst({
      where: (t, { and, eq }) => and(eq(t.sourceText, sourceText), eq(t.targetLang, targetLang)),
    });
  }

  static async listTranslateLogs(limit = 100): Promise<TranslateLog[]> {
    return db.select().from(translateLogs).orderBy(desc(translateLogs.createdAt)).limit(limit);
  }
}
