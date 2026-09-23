import { create } from "zustand";
import type { PageScope } from "../api";

/** How a page is sized in the reader. */
export type FitMode = "height" | "width" | "original";

const FIT_KEY = "read-fit-mode";
const SCOPE_KEY = "studio-scope";

/** A remembered choice, with a fallback when storage is unavailable (private mode) or holds something unexpected. */
function remembered<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    return allowed.find((value) => value === localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not persisted; the choice still applies for this visit
  }
}

interface ReadingState {
  /** Reader: how the page is sized. */
  fit: FitMode;
  /** Reader: the reviews panel is open. */
  showReviews: boolean;
  /** Studio list: which pages it lists. */
  scope: PageScope;
  /** Studio list: the search box. */
  search: string;

  setFit: (fit: FitMode) => void;
  setShowReviews: (shown: boolean) => void;
  setScope: (scope: PageScope) => void;
  setSearch: (search: string) => void;
}

/**
 * What the reader and the Studio's page list are set to: habits rather than data, so they outlive a visit to another
 * page — going back to the Studio finds the same filter, and the reader keeps the fit chosen for this screen.
 */
export const useReadingStore = create<ReadingState>((set) => ({
  fit: remembered(FIT_KEY, ["height", "width", "original"] as const, "height"),
  showReviews: false,
  scope: remembered(SCOPE_KEY, ["inbox", "chapter", "all"] as const, "inbox"),
  search: "",

  setFit: (fit) => {
    remember(FIT_KEY, fit);
    set({ fit });
  },
  setShowReviews: (showReviews) => set({ showReviews }),
  setScope: (scope) => {
    remember(SCOPE_KEY, scope);
    set({ scope });
  },
  setSearch: (search) => set({ search }),
}));
