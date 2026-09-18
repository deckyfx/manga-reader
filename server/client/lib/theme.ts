/**
 * Day or night, remembered per browser.
 *
 * The choice lands on `<html data-theme>`, which flips the grey ramp in index.css. "System" follows the operating
 * system and keeps following it, so a laptop that darkens in the evening takes the app with it.
 */
export type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "theme";

/** What the browser itself prefers right now. */
const systemPrefersDark = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches === false;

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  } catch {
    // Storage can be unavailable (private mode); the app still has a theme, it just won't be remembered
    return "system";
  }
}

/** Puts the choice on the document. "System" resolves now and keeps resolving as the system changes. */
export function applyTheme(theme: Theme): void {
  const resolved = theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not remembered for next time; the choice still applies now
  }
  applyTheme(theme);
}

/**
 * Applies the stored choice and keeps "system" in step with the operating system. Called once, before React renders,
 * so the first paint is already the right colour.
 */
export function startTheme(): () => void {
  applyTheme(readTheme());
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (readTheme() === "system") applyTheme("system");
  };
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
