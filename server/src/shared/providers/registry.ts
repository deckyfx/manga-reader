/**
 * Which extractor handles a page. Adding a site is one file plus one line here.
 *
 * Order matters: the first match wins, and `generic` matches everything, so it stays last.
 */
import { exhentaiExtractor } from "./exhentai";
import { genericExtractor } from "./generic";
import { rawkumaExtractor } from "./rawkuma";
import type { Extractor } from "./types";

export const EXTRACTORS: readonly Extractor[] = [rawkumaExtractor, exhentaiExtractor, genericExtractor];

/** The extractor for this address; never null, since `generic` takes whatever is left. */
export function extractorFor(url: URL): Extractor {
  return EXTRACTORS.find((extractor) => extractor.matches(url)) ?? genericExtractor;
}

/** An extractor by id, for resuming an import the worker had already started. */
export function extractorById(id: string): Extractor | undefined {
  return EXTRACTORS.find((extractor) => extractor.id === id);
}
