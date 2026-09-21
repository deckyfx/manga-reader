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
  /**
   * The chapter's pages, in reading order: image addresses, or — for an extractor with `resolve` — the addresses of
   * the pages that hold them, each turned into its image one at a time as the import reaches it.
   */
  images: string[];
  /** Series or gallery title, for naming the workspace. */
  title?: string;
  /** "14", "14.5" — from the URL or the page, when it can be told. */
  chapter?: string;
  /** Set by extractors for adult sites, and carried into a series filed from the import. */
  adult?: boolean;
}

/** One listed page turned into the image to download, or why it couldn't be. */
export type Resolved =
  | { ok: true; url: string }
  /**
   * `stop` means every later page would fail the same way (a daily image limit), so the import should pause rather
   * than burn through the rest; without it only this page fails.
   */
  | { ok: false; reason: string; stop?: boolean };

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
  /**
   * For a site whose list holds pages rather than images: one listed page to its image address. Runs where the
   * user's cookies are, one page at a time as the import reaches it, so a long gallery starts importing at once
   * instead of after every page has been read. An extractor without it lists images directly.
   */
  resolve?(page: string, ctx: ExtractContext): Promise<Resolved>;
}
