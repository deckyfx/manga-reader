/**
 * What an extractor is given and what it must answer with. Browser-safe: an extractor only ever touches a `Document`
 * and the URL it came from, so the extension can run it against the page the reader is actually looking at (lazy
 * attributes resolved, scripts done) and the tests can run it against saved fixture HTML.
 */

/** The pieces an extractor may use; the extension supplies them (live DOM, same-origin fetch). */
export interface ExtractContext {
  /** Address of the page `document` was loaded from; relative image addresses resolve against it. */
  url: URL;
  /** The open page. */
  document: Document;
  /** Same-origin fetch + DOMParser, with the user's cookies, for readers that spread a chapter over several pages. */
  fetchDocument(url: string): Promise<Document>;
  /** Progress and guesses, shown in the popup when an import goes wrong. */
  log(message: string): void;
}

/** What one chapter (or gallery) page yielded. */
export interface ChapterExtract {
  /** Absolute image addresses, in reading order. */
  images: string[];
  /** Series or gallery title, for naming the workspace. */
  title?: string;
  /** "14", "14.5" — from the URL or the page, when it can be told. */
  chapter?: string;
  /** Set by extractors for adult sites, and carried into a series filed from the import. */
  adult?: boolean;
}

export interface Extractor {
  /** Stored on the workspace as `sourceProvider`. */
  id: string;
  /** Shown in the popup ("Found 25 pages · rawkuma"). */
  label: string;
  /** Whether this extractor handles that address; `generic` matches everything and is tried last. */
  matches(url: URL): boolean;
  /** Smallest gap between image downloads this site tolerates. */
  minIntervalMs: number;
  extract(ctx: ExtractContext): Promise<ChapterExtract>;
}
