import Elysia, { t } from "elysia";
import { bootState } from "@/boot-state";
import { ErrBody } from "@/lib/schemas";
import { cleanMangaText, splitSentences } from "@/lib/sanitizer";
import { analyzeService, type TokenInfo } from "@/services/analyze-service";
import { dictionaryService, type Definition } from "@/services/dictionary-service";

/** Caps concurrent lookups so Jisho mode doesn't fan out one HTTP call per token at once. */
const LOOKUP_CONCURRENCY = 5;

const TokenSchema = t.Object({
  surface: t.String(),
  pos: t.String(),
  pos_detail: t.String(),
  conjugation_type: t.String(),
  conjugation_form: t.String(),
  dictionary_form: t.String(),
  reading: t.String(),
  romaji: t.String(),
  is_unknown: t.Boolean(),
});

/** Maps `items` through `fn` with at most `limit` promises in flight, preserving order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export const routeAnalyze = new Elysia().post(
  "/analyze",
  async ({ body, status: error }) => {
    if (!bootState.dictionaryReady) return error(503, { error: "Dictionary service not ready" });
    if (!body.text.trim()) return error(400, { error: "text is required" });

    const start = Date.now();
    const sanitized = body.sanitize === false ? body.text : cleanMangaText(body.text);
    const mode = body.mode === "jisho" ? "jisho" : "local";
    const tokens = analyzeService.tokenize(sanitized);
    const definitions = await mapLimit<TokenInfo, Definition | null>(tokens, LOOKUP_CONCURRENCY, async (token) =>
      analyzeService.shouldSkip(token.pos) ? null : dictionaryService.lookup(token.dictionary_form, mode),
    );

    return {
      original: body.text,
      sanitized,
      sentences: splitSentences(sanitized),
      tokens,
      definitions,
      elapsed_ms: Date.now() - start,
    };
  },
  {
    body: t.Object({
      text: t.String(),
      sanitize: t.Optional(t.Boolean()),
      mode: t.Optional(t.String()),
    }),
    response: {
      200: t.Object({
        original: t.String(),
        sanitized: t.String(),
        sentences: t.Array(t.String()),
        tokens: t.Array(TokenSchema),
        // Elysia 1.4.30's default normalizer rejects arrays interleaving objects with several nulls,
        // and a plugin-level `normalize` option is ignored once mounted. Shape is enforced by the
        // handler's `Definition | null` type instead.
        definitions: t.Array(t.Nullable(t.Any())),
        elapsed_ms: t.Integer(),
      }),
      400: ErrBody,
      503: ErrBody,
    },
  },
);
