/**
 * Where the reader left off, per chapter. Kept in localStorage: it's per browser, never sent anywhere, and the URL
 * still holds the position when storage is unavailable (private mode, blocked site data).
 */
const progressKey = (chapterId: number) => `read-progress-${chapterId}`;

/** Remembers the page a chapter is being read at. */
export function saveProgress(chapterId: number, pageNumber: number): void {
  try {
    localStorage.setItem(progressKey(chapterId), String(pageNumber));
  } catch {
    // Storage can be unavailable; reading still works, it just won't resume
  }
}

/** The saved page of a chapter, clamped to the pages it has; 1 when nothing is saved. */
export function savedPage(chapterId: number, pages: number): number {
  try {
    const saved = Number(localStorage.getItem(progressKey(chapterId)));
    if (!Number.isFinite(saved) || saved < 1) return 1;
    return pages > 0 ? Math.min(saved, pages) : 1;
  } catch {
    return 1;
  }
}

/** The link that opens a chapter where it was left off. */
export const chapterLink = (chapterId: number, pages: number) => `/read/chapters/${chapterId}/pages/${savedPage(chapterId, pages)}`;

/** Forgets a chapter's position (it has been read to the end, or its pages changed). */
export function clearProgress(chapterId: number): void {
  try {
    localStorage.removeItem(progressKey(chapterId));
  } catch {
    // Nothing to clean up when storage is unavailable
  }
}
