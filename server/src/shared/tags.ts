/**
 * What a series' tags may be, in one place for the route that stores them and every form that sends them (the
 * Studio's File dialog, the extension's "New series from this page"). Browser-safe.
 */

/** Tags one series may carry. */
export const MAX_SERIES_TAGS = 30;
/** Characters in one tag. */
export const MAX_TAG_LENGTH = 40;

/** A comma-separated tag field as the tags it names: trimmed, lower case, each once, blanks dropped. */
export function splitTags(text: string): string[] {
  return [...new Set(text.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

/** Why these tags would be refused, or null when they're fine; said so a form can show it before sending. */
export function tagProblem(tags: readonly string[]): string | null {
  if (tags.length > MAX_SERIES_TAGS) return `Use at most ${MAX_SERIES_TAGS} tags (there are ${tags.length}).`;
  const long = tags.find((tag) => tag.length > MAX_TAG_LENGTH);
  if (long) return `Keep each tag to ${MAX_TAG_LENGTH} characters: “${long.slice(0, MAX_TAG_LENGTH)}…” is longer.`;
  return null;
}
