import { create } from "zustand";
import { readTheme, saveTheme, type Theme } from "../lib/theme";

interface ThemeState {
  theme: Theme;
  /** Applies the choice, remembers it, and tells every control showing it. */
  setTheme: (theme: Theme) => void;
}

/**
 * Day, night or follow the system. The choice lives here so anything can read or change it; `lib/theme.ts` still owns
 * putting it on the document (it runs before React, so the first paint is already right).
 */
export const useThemeStore = create<ThemeState>((set) => ({
  theme: readTheme(),
  setTheme: (theme) => {
    saveTheme(theme);
    set({ theme });
  },
}));
